import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import parse_qs, unquote, urlsplit

import pytest

import artist_tools_mcp as mcp

NOW = datetime(2026, 10, 10, 10, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def isolated_recovery_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNNER_TEMP", str(tmp_path))


class Response:
    def __init__(self, body=None, status=200, headers=None, lines=()):
        self.body, self.status_code = body, status
        self.headers = headers or {"Content-Type": "application/json"}
        self.lines, self.closed = lines, False
        self.ok = status < 400

    def json(self):
        return self.body

    def iter_lines(self, **kwargs):
        assert kwargs["chunk_size"] == 1
        yield from self.lines

    def close(self):
        self.closed = True

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError("HTTP failed")


class OAuthPG:
    base, h = "https://db.invalid/rest/v1", {"apikey": "test-service"}

    def __init__(self):
        self.row = {"id": "default", "client_id": "client", "client_secret": None,
                    "access_token": "old-access", "refresh_token": "old-refresh",
                    "token_endpoint": "https://auth.invalid/token",
                    "access_token_expires_at": (NOW + timedelta(minutes=1)).isoformat(),
                    "lock_owner": None, "locked_until": None}
        self.events = []

    def _request(self, method, url, headers, data, **kwargs):
        values = json.loads(data)
        if method == "POST":
            return Response(status=201)
        filters = unquote(urlsplit(url).query)
        self.events.append((values, filters))
        assert headers["Prefer"] == "return=representation"
        assert kwargs["idempotent"] is False
        if "or=(" in filters and self.row["locked_until"] and mcp.timestamp(self.row["locked_until"]) >= NOW:
            return Response([])
        owner = parse_qs(filters).get("lock_owner", [None])[0]
        if owner and owner != "eq." + str(self.row["lock_owner"]):
            return Response([])
        self.row.update(values)
        return Response([dict(self.row)])


def test_rotation_persisted_before_mcp_and_finally_released():
    pg = OAuthPG()

    class HTTP:
        def post(self, url, **kwargs):
            if url.endswith("/token"):
                assert kwargs["data"]["refresh_token"] == "old-refresh"
                return Response({"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600})
            assert pg.row["refresh_token"] == "new-refresh"
            assert kwargs["headers"]["Authorization"] == "Bearer new-access"
            return Response({"id": 1, "result": {"result": {"added": True}}})

    http = HTTP()
    with mcp.TokenManager(pg, session=http, now=lambda: NOW, sleep=lambda _: None) as tokens:
        client = mcp.MCPClient(tokens, session=http)
        client.initialized = True
        assert client.call_tool("add_entity_to_folder", {})["result"]["added"]
        assert pg.row["lock_owner"] == tokens.owner
    assert pg.row["lock_owner"] is None
    assert pg.row["refresh_token_obtained_at"] == NOW.isoformat()
    assert "or=(locked_until.is.null,locked_until.lt." in pg.events[0][1]


def test_lease_contention_second_runner_aborts_without_refresh():
    pg = OAuthPG()
    with mcp.TokenManager(pg, now=lambda: NOW) as first:
        with pytest.raises(mcp.LeaseBusy):
            with mcp.TokenManager(pg, now=lambda: NOW):
                pytest.fail("Second runner entered")
        assert pg.row["lock_owner"] == first.owner


def test_invalid_grant_is_sanitized_and_lease_released():
    pg = OAuthPG()
    session = SimpleNamespace(post=lambda *a, **k: Response({"error": "invalid_grant", "secret": "old-refresh"}, 400))
    with pytest.raises(mcp.ArtistToolsError, match="re-run authorize") as error:
        with mcp.TokenManager(pg, session=session, now=lambda: NOW) as tokens:
            tokens.access_token()
    assert "old-refresh" not in str(error.value)
    assert pg.row["lock_owner"] is None


def test_rotation_persist_failure_never_calls_mcp():
    pg = OAuthPG()
    original = pg._request
    calls = []

    def fail_persist(method, url, headers, data, **kwargs):
        if "refresh_token" in json.loads(data):
            return Response({}, 500)
        return original(method, url, headers, data, **kwargs)

    pg._request = fail_persist

    def post(url, **kwargs):
        calls.append(url)
        return Response({"access_token": "new-access", "refresh_token": "rotated"})

    with pytest.raises(mcp.ArtistToolsError):
        with mcp.TokenManager(pg, session=SimpleNamespace(post=post), now=lambda: NOW) as tokens:
            mcp.MCPClient(tokens).call_tool("who_am_i", {})
    assert calls == ["https://auth.invalid/token"]


def test_long_retry_wait_renews_lease_and_lost_lease_stops():
    pg = OAuthPG()
    clock = [NOW]
    with mcp.TokenManager(pg, now=lambda: clock[0], sleep=lambda s: clock.__setitem__(0, clock[0] + timedelta(seconds=s))) as tokens:
        tokens.wait(900)
        assert sum("locked_until" in values for values, _ in pg.events) >= 5
        assert mcp.timestamp(pg.row["locked_until"]) > clock[0]
        pg.row["lock_owner"] = "new-runner"
        clock[0] += timedelta(minutes=2)
        with pytest.raises(mcp.ArtistToolsError, match="lost"):
            tokens.heartbeat()
    assert pg.row["lock_owner"] == "new-runner"


def test_access_token_with_more_than_five_minutes_does_not_refresh():
    pg = OAuthPG()
    pg.row["access_token_expires_at"] = (NOW + timedelta(minutes=6)).isoformat()
    with mcp.TokenManager(pg, now=lambda: NOW) as tokens:
        assert tokens.access_token() == "old-access"


def test_confidential_refresh_uses_basic_and_never_body_secret():
    pg = OAuthPG()
    pg.row.update(client_id="client:id", client_secret="private secret")

    def post(url, **kwargs):
        assert kwargs["auth"] == ("client%3Aid", "private+secret")
        assert "client_secret" not in kwargs["data"]
        return Response({"access_token": "new-access", "refresh_token": "rotated", "expires_in": 3600})

    with mcp.TokenManager(pg, session=SimpleNamespace(post=post), now=lambda: NOW) as tokens:
        assert tokens.access_token() == "new-access"


@pytest.mark.parametrize("sse", [False, True])
def test_json_and_sse_response_parsing(sse):
    body = {"jsonrpc": "2.0", "id": 4, "result": {"hello": "world"}}
    response = Response(body)
    if sse:
        response = Response(headers={"Content-Type": "text/event-stream; charset=utf-8"}, lines=[
            ": keepalive", "", 'data: {"jsonrpc":"2.0","method":"notifications/progress"}', "",
            "event: message", "data: " + json.dumps(body), "",
        ])
    assert mcp.parse_rpc_response(response, 4) == body


def test_sse_multiline_and_mismatched_json():
    response = Response(headers={"Content-Type": "text/event-stream"}, lines=[
        'data: {"id":4,', 'data: "result": {"value": 8}}', "",
    ])
    assert mcp.parse_rpc_response(response, 4)["result"]["value"] == 8
    with pytest.raises(mcp.ArtistToolsError, match="mismatch"):
        mcp.parse_rpc_response(Response({"id": 99}), 4)


class StubTokens:
    def __init__(self):
        self.waits, self.refreshes, self.clock = [], [], 0

    def wait(self, seconds):
        self.waits.append(seconds)
        self.clock += seconds

    def access_token(self, force_refresh=False):
        self.refreshes.append(force_refresh)
        return "new" if any(self.refreshes) else "old"


def client_for(responses):
    tokens = StubTokens()
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs)
        return responses.pop(0)

    client = mcp.MCPClient(tokens, SimpleNamespace(post=post), monotonic=lambda: tokens.clock)
    client.initialized = True
    return client, tokens, calls


def test_retry_after_and_concurrency_limit_then_success():
    client, tokens, calls = client_for([
        Response({"id": 1, "error": {"code": -32000, "data": {"code": "concurrency_limit_exceeded", "retryable": True, "retryAfterSeconds": 17}}}),
        Response({"id": 1, "result": {"content": [{"type": "text", "text": '{"result":{"items":[],"totalCount":0}}'}]}}),
    ])
    assert client.call_tool("list_dashboard_entities", {})["result"]["totalCount"] == 0
    assert any(17 <= wait < 18 for wait in tokens.waits)
    assert client.rate_limited
    assert len(calls) == 2


def test_http_retry_after_header():
    client, tokens, _ = client_for([
        Response({"code": "rate_limit_exceeded"}, 429, {"Retry-After": "20"}),
        Response({"id": 1, "result": {}}),
    ])
    client.call_tool("who_am_i", {})
    assert any(20 <= wait < 21 for wait in tokens.waits)


def test_non_json_gateway_429_is_retried():
    response = Response({}, 429, {"Retry-After": "10"})
    response.json = lambda: (_ for _ in ()).throw(ValueError("not JSON"))
    client, tokens, _ = client_for([response, Response({"id": 1, "result": {}})])
    client.call_tool("who_am_i", {})
    assert any(10 <= wait < 11 for wait in tokens.waits)


def test_generic_daily_window_limit_stops_without_retry():
    client, tokens, calls = client_for([Response({"id": 1, "error": {
        "code": "rate_limit_exceeded", "period": "daily", "retryable": True}}, 429)])
    with pytest.raises(mcp.DailyLimit):
        client.call_tool("add_entity_to_folder", {})
    assert client.daily_limited and len(calls) == 1


def test_daily_limit_stops_without_retry():
    client, tokens, calls = client_for([Response({"id": 1, "result": {
        "isError": True, "content": [{"type": "text", "text": json.dumps({
            "code": "daily_limit_exceeded", "retryable": True, "retryAfterSeconds": 86400})}],
    }})])
    with pytest.raises(mcp.DailyLimit):
        client.call_tool("add_entity_to_folder", {})
    assert client.daily_limited and len(calls) == 1
    assert max(tokens.waits) == 0


def test_401_refreshes_only_once_then_retries():
    client, tokens, calls = client_for([Response({}, 401), Response({"id": 1, "result": {}})])
    client.call_tool("who_am_i", {})
    assert tokens.refreshes == [False, True, False]
    assert calls[1]["headers"]["Authorization"] == "Bearer new"


def test_second_401_is_hard_error():
    client, tokens, _ = client_for([Response({}, 401), Response({}, 401)])
    with pytest.raises(mcp.ArtistToolsError, match="re-run authorize"):
        client.call_tool("who_am_i", {})
    assert tokens.refreshes.count(True) == 1


def test_initialize_notification_and_session_header():
    responses = [Response({"id": 1, "result": {"protocolVersion": mcp.PROTOCOL_VERSION}},
                          headers={"Content-Type": "application/json", "Mcp-Session-Id": "session-123"}),
                 Response(status=202), Response({"id": 3, "result": {"structuredContent": {"result": {"ok": True}}}})]
    client, tokens, calls = client_for(responses)
    client.initialized = False
    assert client.call_tool("who_am_i", {})["result"]["ok"]
    assert [call["json"]["method"] for call in calls] == ["initialize", "notifications/initialized", "tools/call"]
    assert "id" not in calls[1]["json"]
    assert calls[2]["headers"]["Mcp-Session-Id"] == "session-123"


def test_pacing_for_free_tool_quotas():
    client, tokens, _ = client_for([Response({"id": i, "result": {}}) for i in range(1, 5)])
    client.call_tool("add_entity_to_folder", {})
    client.call_tool("add_entity_to_folder", {})
    client.call_tool("list_dashboard_entities", {})
    client.call_tool("list_dashboard_entities", {})
    assert tokens.waits[1] > 60 / 7
    assert tokens.waits[3] >= 12


def test_authorize_falls_back_to_root_protected_resource_metadata(monkeypatch):
    seen = []

    class HTTP:
        def get(self, url, **kwargs):
            seen.append(url)
            if url.endswith("oauth-protected-resource/mcp"):
                return Response("<html>", 404, {"Content-Type": "text/html"})
            if url.endswith("oauth-protected-resource"):
                return Response({"resource": mcp.MCP_URL, "authorization_servers": ["http://insecure.invalid"]})
            raise AssertionError(url)

    monkeypatch.setattr(mcp.requests, "Session", lambda: HTTP())
    with pytest.raises(mcp.ArtistToolsError):
        mcp.authorize(OAuthPG())
    assert seen == [
        "https://app.artist.tools/.well-known/oauth-protected-resource/mcp",
        "https://app.artist.tools/.well-known/oauth-protected-resource",
    ]


def test_authorize_discovery_pkce_callback_and_store(monkeypatch, capsys):
    pg, opened, posted = OAuthPG(), [], []

    class HTTP:
        def get(self, url, **kwargs):
            # Live artist.tools: path-inserted metadata is JSON; the root form is an HTML 404.
            if url.endswith("oauth-protected-resource/mcp"):
                return Response({"resource": mcp.MCP_URL, "authorization_servers": ["https://auth.invalid"]})
            if url.endswith("oauth-protected-resource"):
                return Response("<html>", 404, {"Content-Type": "text/html"})
            assert url == "https://auth.invalid/.well-known/oauth-authorization-server"
            return Response({"authorization_endpoint": "https://auth.invalid/authorize", "token_endpoint": "https://auth.invalid/token",
                             "registration_endpoint": "https://auth.invalid/register", "token_endpoint_auth_methods_supported": ["none"]})

        def post(self, url, **kwargs):
            posted.append((url, kwargs))
            if url.endswith("register"):
                assert kwargs["json"]["redirect_uris"] == ["http://127.0.0.1:54321/callback"]
                return Response({"client_id": "registered-client"}, 201)
            params = parse_qs(urlsplit(opened[0]).query)
            verifier = kwargs["data"]["code_verifier"]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
            assert params["code_challenge"] == [challenge]
            assert params["code_challenge_method"] == ["S256"]
            assert kwargs["data"]["code"] == "private-code"
            return Response({"access_token": "private-access", "refresh_token": "private-refresh", "expires_in": 3600})

    class Server:
        server_port = 54321

        def __init__(self, address, handler):
            assert address == ("127.0.0.1", 0)
            self.handler = handler

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def handle_request(self):
            import io
            handler = object.__new__(self.handler)
            state = parse_qs(urlsplit(opened[0]).query)["state"][0]
            handler.path = "/callback?" + mcp.urlencode({"state": state, "code": "private-code"})
            handler.send_response = lambda _: None
            handler.end_headers = lambda: None
            handler.wfile = io.BytesIO()
            handler.do_GET()

    monkeypatch.setattr(mcp.requests, "Session", HTTP)
    monkeypatch.setattr(mcp, "HTTPServer", Server)
    monkeypatch.setattr(mcp.webbrowser, "open", lambda url: opened.append(url))
    mcp.authorize(pg)
    assert pg.row["refresh_token"] == "private-refresh"
    assert pg.row["client_id"] == "registered-client"
    assert pg.row["lock_owner"] is None
    output = capsys.readouterr().out
    assert "private" not in output
