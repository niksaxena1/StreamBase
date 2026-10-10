"""Service-role OAuth store and serialized, free-plan artist.tools MCP client.

Credentials are never printed. Failed token persistence uses a private recovery
file outside the repo. The lease covers refresh rotation and rate-limit waits.
"""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import random
import secrets
import time
from urllib.parse import parse_qs, quote, quote_plus, urlencode, urlsplit
import uuid
import webbrowser

import requests

from streambase_postgrest import Postgrest

MCP_URL = "https://app.artist.tools/mcp"
PROTOCOL_VERSION = "2025-03-26"


class ArtistToolsError(RuntimeError):
    """Only deliberately sanitized messages may reach logs/run details."""


class LeaseBusy(ArtistToolsError):
    pass


class DailyLimit(ArtistToolsError):
    pass


def utcnow():
    return datetime.now(timezone.utc)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def database_from_env():
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise ArtistToolsError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    return Postgrest(url, key)


def owner_only(path, directory=False):
    """POSIX 0600/0700; Windows protected DACL granting only OWNER RIGHTS."""
    if os.name != "nt":
        path.chmod(0o700 if directory else 0o600)
        return
    import ctypes
    from ctypes import wintypes
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    descriptor = ctypes.c_void_p()
    convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    convert.restype = wintypes.BOOL
    set_security = advapi.SetFileSecurityW
    set_security.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    set_security.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    sddl = "D:P(A;OICI;FA;;;OW)" if directory else "D:P(A;;FA;;;OW)"
    if not convert(sddl, 1, ctypes.byref(descriptor), None):
        raise ArtistToolsError("Could not create owner-only recovery permissions.")
    try:
        # DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION
        if not set_security(str(path), 0x80000004, descriptor):
            raise ArtistToolsError("Could not secure the local OAuth recovery file.")
    finally:
        kernel.LocalFree(descriptor)


class TokenManager:
    def __init__(self, pg, account="default", session=None, now=utcnow, sleep=time.sleep):
        self.pg, self.account = pg, account
        self.session = session or requests.Session()
        self.now, self.sleep = now, sleep
        self.owner = str(uuid.uuid4())
        self.row = None
        self.renew_at = None
        self.held = False
        self.keep_lease = False
        self.pending_recovery = None

    @property
    def recovery_path(self):
        base = os.environ.get("RUNNER_TEMP") or os.environ.get("LOCALAPPDATA")
        if not base:
            base = os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
        fingerprint = hashlib.sha256(f"{self.pg.base}\n{self.account}".encode()).hexdigest()
        path = (Path(base) / "StreamBase" / "artist-tools-recovery" / f"{fingerprint}.json").resolve()
        if path.is_relative_to(Path(__file__).resolve().parents[1]):
            raise ArtistToolsError("OAuth recovery storage must be outside the repository.")
        return path

    def _load_recovery(self):
        path = self.recovery_path
        if not path.exists():
            return None
        try:
            owner_only(path)
            pending = json.loads(path.read_text(encoding="utf-8"))
            values = pending["values"]
            allowed = {"client_id", "client_secret", "token_endpoint", "access_token", "access_token_expires_at",
                       "refresh_token", "refresh_token_obtained_at", "updated_at"}
            if (pending["account"] != self.account or pending["database"] != self.pg.base
                    or set(values) - allowed or not values.get("refresh_token")
                    or not values.get("access_token")):
                raise ValueError("Recovery identity mismatch")
            uuid.UUID(pending["lock_owner"])
            return pending
        except Exception:
            raise ArtistToolsError("Private OAuth recovery file is unreadable or invalid; no credentials logged.") from None

    def _save_recovery(self, values):
        path = self.recovery_path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        owner_only(path.parent, directory=True)  # Secure directory BEFORE creating secret content.
        temporary = path.with_suffix(f".{uuid.uuid4()}.tmp")
        payload = {"account": self.account, "database": self.pg.base, "lock_owner": self.owner,
                   "previous_refresh_token": self.row.get("refresh_token"),
                   "values": {"client_id": self.row.get("client_id"), "client_secret": self.row.get("client_secret"),
                              "token_endpoint": self.row.get("token_endpoint"), **values}}
        try:
            fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                owner_only(temporary)
                json.dump(payload, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        return path

    def _restore_recovery(self):
        pending = self.pending_recovery
        if not pending:
            return
        # A later reauthorization/rotation supersedes a stale local recovery.
        if self.row.get("refresh_token") in (pending.get("previous_refresh_token"), pending["values"]["refresh_token"]):
            self.persist(pending["values"])
        else:
            self.recovery_path.unlink(missing_ok=True)
        self.pending_recovery = None

    def _patch(self, values, filters):
        headers = {**self.pg.h, "Prefer": "return=representation"}
        try:
            response = self.pg._request(
                "PATCH", f"{self.pg.base}/artist_tools_oauth?{filters}", headers,
                data=json.dumps(values), idempotent=False,
            )
            if response.status_code != 200:
                raise ArtistToolsError("OAuth store update failed; tokens were not logged.")
            return response.json()
        except ArtistToolsError:
            raise
        except Exception:
            raise ArtistToolsError("OAuth store unavailable; tokens were not logged.") from None

    @property
    def account_filter(self):
        return f"id=eq.{quote(self.account, safe='')}"

    def _owned_filter(self):
        now = quote(self.now().isoformat(), safe="")
        return f"{self.account_filter}&lock_owner=eq.{self.owner}&locked_until=gt.{now}"

    def __enter__(self):
        self.pending_recovery = self._load_recovery()
        now = self.now()
        # The private file allows an immediate, conditional lease transfer on
        # this machine. Two recovering runners still cannot both acquire it.
        recover_owner = f",lock_owner.eq.{self.pending_recovery['lock_owner']}" if self.pending_recovery else ""
        filters = (f"{self.account_filter}&or=(locked_until.is.null,"
                   f"locked_until.lt.{quote(now.isoformat(), safe='')}{recover_owner})")
        rows = self._patch({"lock_owner": self.owner,
                            "locked_until": (now + timedelta(minutes=10)).isoformat()}, filters)
        if not rows or rows[0].get("lock_owner") != self.owner:
            raise LeaseBusy("Another runner holds the artist.tools lease (or authorize has not created the account). Retry later.")
        self.row = rows[0]
        self.held = True
        self.renew_at = now + timedelta(minutes=2)
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.held:
            if self.keep_lease:
                self.held = False  # Leave database owner/expiry intact for recovery.
                return
            try:
                self._patch({"lock_owner": None, "locked_until": None},
                            f"{self.account_filter}&lock_owner=eq.{self.owner}")
            except Exception:
                if exc_type is None:
                    raise
            finally:
                self.held = False

    def heartbeat(self):
        if not self.held:
            raise ArtistToolsError("artist.tools lease is not held.")
        now = self.now()
        if now >= self.renew_at:
            rows = self._patch({"locked_until": (now + timedelta(minutes=10)).isoformat()},
                               self._owned_filter())
            if not rows or rows[0].get("lock_owner") != self.owner:
                raise ArtistToolsError("artist.tools lease expired or was lost; stopping.")
            self.renew_at = now + timedelta(minutes=2)

    def wait(self, seconds):
        # Keep the lease alive even for retryAfter values longer than ten minutes.
        while seconds > 0:
            self.heartbeat()
            part = min(seconds, 30)
            self.sleep(part)
            seconds -= part
        self.heartbeat()

    def persist(self, values):
        patch = {**values, "updated_at": self.now().isoformat()}
        # Acquiring a conditional lease is not idempotent. Token persistence IS:
        # retry the same values here, separately from the lease PATCH semantics,
        # including 500-after-commit and connection/timeout errors.
        for attempt in range(4):
            try:
                self.heartbeat()
                rows = self._patch(patch, self._owned_filter())
                if not rows or rows[0].get("lock_owner") != self.owner:
                    raise ArtistToolsError("Could not persist OAuth tokens under the lease; stopping.")
                self.row.update(values)
                self.keep_lease = False
                self.recovery_path.unlink(missing_ok=True)
                return
            except ArtistToolsError:
                if attempt < 3:
                    self.sleep(2 ** attempt + random.uniform(0, 1))
        self.keep_lease = True
        try:
            path = self._save_recovery(values)
        except Exception:
            raise ArtistToolsError("OAuth persistence and secure recovery write failed; lease retained. Re-run authorize.") from None
        raise ArtistToolsError(f"OAuth token persistence failed; private recovery saved at {path}. Lease retained; next local run will restore it.")

    def access_token(self, force_refresh=False):
        self.heartbeat()
        self._restore_recovery()  # BEFORE trying a possibly invalid old refresh token.
        expiry = self.row.get("access_token_expires_at")
        if (not force_refresh and self.row.get("access_token") and expiry
                and timestamp(expiry) > self.now() + timedelta(minutes=5)):
            return self.row["access_token"]
        if not self.row.get("refresh_token") or not self.row.get("token_endpoint"):
            raise ArtistToolsError("Missing artist.tools authorization; re-run authorize.")
        data = {"grant_type": "refresh_token", "refresh_token": self.row["refresh_token"],
                "client_id": self.row["client_id"], "resource": MCP_URL}
        if self.row.get("client_secret"):
            data["client_secret"] = self.row["client_secret"]
        tokens = token_exchange(self.session, self.row["token_endpoint"], data)
        if not tokens.get("refresh_token"):
            raise ArtistToolsError("Refresh returned no rotated token; re-run authorize.")
        # Rotation invalidates the old refresh token. Persist BEFORE any MCP call.
        self.persist(token_values(tokens, self.now()))
        return self.row["access_token"]


def token_values(tokens, now):
    if not tokens.get("access_token") or not tokens.get("refresh_token"):
        raise ArtistToolsError("OAuth returned incomplete tokens; re-run authorize.")
    return {"access_token": tokens["access_token"], "refresh_token": tokens["refresh_token"],
            "access_token_expires_at": (now + timedelta(seconds=int(tokens.get("expires_in", 3600)))).isoformat(),
            "refresh_token_obtained_at": now.isoformat()}


def token_exchange(session, endpoint, data):
    require_https(endpoint)
    data = dict(data)
    secret = data.pop("client_secret", None)
    auth = None
    if secret:
        # RFC 6749: form-encode credentials before HTTP Basic authentication.
        auth = (quote_plus(data["client_id"], safe=""), quote_plus(secret, safe=""))
    try:
        response = session.post(endpoint, data=data, auth=auth, timeout=60)
        body = response.json()
    except Exception:
        raise ArtistToolsError("OAuth exchange failed; re-run authorize if refresh was rotated.") from None
    if body.get("error") == "invalid_grant":
        raise ArtistToolsError("artist.tools invalid_grant: re-run authorize (token expired or revoked).")
    if not response.ok or body.get("error"):
        raise ArtistToolsError(f"OAuth exchange failed (HTTP {response.status_code}); no tokens logged.")
    return body


def parse_rpc_response(response, expected_id):
    """Read the matching JSON-RPC message, ignoring SSE comments/notifications."""
    if response.status_code in (202, 204):
        return {}
    if "text/event-stream" not in response.headers.get("Content-Type", ""):
        body = response.json()
        if expected_id is not None and body.get("id") not in (expected_id, None):
            raise ArtistToolsError("MCP response ID mismatch.")
        return body
    data = []
    deadline = time.monotonic() + 60
    # Read small SSE events immediately even when the server keeps the HTTP
    # stream open; requests' default 512-byte buffer can delay a short reply.
    for line in response.iter_lines(chunk_size=1, decode_unicode=True):
        if time.monotonic() >= deadline:
            raise ArtistToolsError("MCP stream response deadline exceeded.")
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line.startswith("data:"):
            data.append(line[5:].lstrip())
        elif not line and data:
            body = json.loads("\n".join(data))
            data = []
            if body.get("id") == expected_id:
                return body
    if data:
        body = json.loads("\n".join(data))
        if body.get("id") == expected_id:
            return body
    raise ArtistToolsError("MCP stream ended without a matching response.")


def tool_payload(result):
    if "structuredContent" in result:
        return result["structuredContent"]
    for block in result.get("content", []):
        if block.get("type") == "text":
            try:
                return json.loads(block["text"])
            except (ValueError, KeyError):
                continue
    return result


class MCPClient:
    def __init__(self, tokens, session=None, monotonic=time.monotonic):
        self.tokens = tokens
        self.session = session or requests.Session()
        self.monotonic = monotonic
        self.session_id = None
        self.protocol_version = PROTOCOL_VERSION
        self.next_id = 0
        self.next_global = 0
        self.next_tool = {}
        self.rate_limited = False
        self.daily_limited = False
        self.initialized = False

    def _pace(self, tool):
        due = max(self.next_global, self.next_tool.get(tool, 0))
        self.tokens.wait(max(0, due - self.monotonic()))
        now = self.monotonic()
        self.next_global = now + 2.1  # <30/min, concurrency always one
        interval = {"add_entity_to_folder": 60 / 7 + .2, "list_dashboard_entities": 12.2}.get(tool, 0)
        if interval:
            self.next_tool[tool] = now + interval

    def _rpc(self, method, params=None, tool=None, notification=False):
        self.next_id += 1
        rpc_id = self.next_id
        message = {"jsonrpc": "2.0", "method": method}
        if not notification:
            message["id"] = rpc_id
        if params is not None:
            message["params"] = params
        refreshed = False
        for attempt in range(6):
            headers = {"Authorization": f"Bearer {self.tokens.access_token()}",
                       "Accept": "application/json, text/event-stream",
                       "MCP-Protocol-Version": self.protocol_version}
            if self.session_id:
                headers["Mcp-Session-Id"] = self.session_id
            self._pace(tool)  # Schedule from actual send time, AFTER any slow refresh.
            try:
                response = self.session.post(MCP_URL, json=message, headers=headers, timeout=60, stream=True)
            except requests.RequestException:
                raise ArtistToolsError("MCP network request failed.") from None
            try:
                if response.status_code == 401:
                    if refreshed:
                        raise ArtistToolsError("MCP authorization rejected after refresh; re-run authorize.")
                    self.tokens.access_token(force_refresh=True)
                    refreshed = True
                    continue
                if response.headers.get("Mcp-Session-Id"):
                    self.session_id = response.headers["Mcp-Session-Id"]
                try:
                    body = parse_rpc_response(response, None if notification else rpc_id)
                except ValueError:
                    if response.status_code != 429:
                        raise ArtistToolsError("MCP returned an invalid JSON response.") from None
                    body = {}  # Some gateways return a non-JSON 429 with Retry-After.
                result = tool_payload(body.get("result", {}))
                inner = result.get("result") or {}
                error = body.get("error") or result.get("error") or inner.get("error")
                if not error and (result.get("code") or body.get("code")):
                    error = result if result.get("code") else body
                # MCP errors sometimes wrap machine-readable details in data.
                if error:
                    details = error.get("data") or {}
                    error = {**error, **(details if isinstance(details, dict) else {})}
                code = str((error or {}).get("code", "")).lower()
                period = str((error or {}).get("period") or (error or {}).get("window")
                             or (error or {}).get("limitType") or "").lower()
                if (("daily" in code or "day" in code or period in ("day", "daily"))
                        and ("limit" in code or "quota" in code or response.status_code == 429)):
                    self.rate_limited = self.daily_limited = True
                    raise DailyLimit("artist.tools daily quota reached.")
                retryable = response.status_code == 429 or bool((error or {}).get("retryable"))
                if retryable:
                    self.rate_limited = True
                    if attempt == 5:
                        raise ArtistToolsError("MCP retry limit reached.")
                    delay = (error or {}).get("retryAfterSeconds", response.headers.get("Retry-After", 0))
                    self.tokens.wait(max(float(delay or 0), 2 ** attempt) + random.uniform(0, 1))
                    continue
                if not response.ok or error or body.get("result", {}).get("isError"):
                    raise ArtistToolsError(f"MCP call failed (HTTP {response.status_code}); provider details withheld.")
                return result
            finally:
                response.close()
        raise ArtistToolsError("MCP retry limit reached.")

    def initialize(self):
        result = self._rpc("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {},
                                           "clientInfo": {"name": "StreamBase", "version": "1.0"}})
        if result.get("protocolVersion") not in (PROTOCOL_VERSION, "2024-11-05", "2025-06-18"):
            raise ArtistToolsError("MCP server negotiated an unsupported protocol version.")
        self.protocol_version = result["protocolVersion"]
        self._rpc("notifications/initialized", notification=True)
        self.initialized = True

    def call_tool(self, name, arguments):
        if not self.initialized:
            self.initialize()
        return self._rpc("tools/call", {"name": name, "arguments": arguments}, tool=name)


def require_https(url):
    if urlsplit(url).scheme != "https" or not urlsplit(url).hostname:
        raise ArtistToolsError("OAuth metadata requires HTTPS endpoints.")


def authorize(pg, account="default"):
    session = requests.Session()
    origin = "https://app.artist.tools"
    protected = session.get(origin + "/.well-known/oauth-protected-resource", timeout=30)
    protected.raise_for_status()
    resource = protected.json()
    issuer = resource["authorization_servers"][0].rstrip("/")
    require_https(issuer)
    parts = urlsplit(issuer)
    discovery = f"{parts.scheme}://{parts.netloc}/.well-known/oauth-authorization-server{parts.path}"
    response = session.get(discovery, timeout=30)
    response.raise_for_status()
    metadata = response.json()
    for key in ("authorization_endpoint", "token_endpoint", "registration_endpoint"):
        require_https(metadata[key])
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    captured = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # callback URL contains the authorization code

        def do_GET(self):
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)
            valid = parts.path == "/callback" and query.get("state") == [state]
            if valid:
                captured.update({key: value[0] for key, value in query.items()})
            self.send_response(200 if valid else 400)
            self.end_headers()
            self.wfile.write(b"You can close this tab." if valid else b"Invalid callback.")

    # Create an empty account without replacing an existing runner's credentials.
    headers = {**pg.h, "Prefer": "resolution=ignore-duplicates,return=minimal"}
    response = pg._request("POST", f"{pg.base}/artist_tools_oauth?on_conflict=id", headers,
                           data=json.dumps([{"id": account}]), idempotent=True)
    if response.status_code not in (200, 201, 204):
        raise ArtistToolsError("Could not create OAuth account row.")
    with HTTPServer(("127.0.0.1", 0), Callback) as server, TokenManager(pg, account, session) as tokens:
        redirect = f"http://127.0.0.1:{server.server_port}/callback"
        methods = metadata.get("token_endpoint_auth_methods_supported", ["client_secret_basic"])
        auth_method = "none" if "none" in methods else "client_secret_basic"
        if auth_method not in methods:
            raise ArtistToolsError("OAuth server must support public clients or client_secret_basic.")
        registration = session.post(metadata["registration_endpoint"], json={
            "client_name": "StreamBase artist.tools daily", "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"],
            "token_endpoint_auth_method": auth_method,
        }, timeout=30)
        if not registration.ok:
            raise ArtistToolsError("OAuth client registration failed.")
        client = registration.json()
        client_secret = client.get("client_secret") if auth_method == "client_secret_basic" else None
        if auth_method == "client_secret_basic" and not client_secret:
            raise ArtistToolsError("OAuth registration returned no confidential client secret.")
        params = {"response_type": "code", "client_id": client["client_id"], "redirect_uri": redirect,
                  "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
                  "resource": resource.get("resource", MCP_URL)}
        scopes = resource.get("scopes_supported") or metadata.get("scopes_supported")
        if scopes:
            params["scope"] = " ".join(scopes)
        webbrowser.open(metadata["authorization_endpoint"] + "?" + urlencode(params))
        print("Complete artist.tools authorization in the browser (five-minute timeout).")
        deadline = time.monotonic() + 300
        server.timeout = 1
        while not captured and time.monotonic() < deadline:
            tokens.heartbeat()
            server.handle_request()
        if not captured.get("code"):
            raise ArtistToolsError("Authorization was denied or timed out; re-run authorize.")
        data = {"grant_type": "authorization_code", "code": captured["code"], "redirect_uri": redirect,
                "code_verifier": verifier, "client_id": client["client_id"], "resource": params["resource"]}
        if client_secret:
            data["client_secret"] = client_secret
        exchanged = token_exchange(session, metadata["token_endpoint"], data)
        tokens.persist({"client_id": client["client_id"], "client_secret": client_secret,
                        "token_endpoint": metadata["token_endpoint"], **token_values(exchanged, utcnow())})
    print("Authorization stored in Supabase. No tokens were printed.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    auth = sub.add_parser("authorize", help="Authorize once locally using the owner's browser")
    auth.add_argument("--account", default="default")
    args = parser.parse_args(argv)
    try:
        authorize(database_from_env(), args.account)
        return 0
    except Exception as exc:
        print(str(exc) if isinstance(exc, ArtistToolsError) else f"Authorization failed ({type(exc).__name__}); no credentials logged.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
