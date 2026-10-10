"""Reviewer regressions: HTTP/PostgREST are mocked; no live services."""
import json
import os
from pathlib import Path
import stat
import shutil
import subprocess
import textwrap
from types import SimpleNamespace
from urllib.parse import unquote

import pytest

import artist_tools_daily as daily
import artist_tools_mcp as mcp
from streambase_postgrest import Postgrest
from test_artist_tools_daily import PG, Client, D, folder, run
from test_artist_tools_mcp import NOW, OAuthPG, Response, StubTokens


@pytest.fixture(autouse=True)
def isolated_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNNER_TEMP", str(tmp_path))
    monkeypatch.setattr(daily, "SUMMARY_PATH", tmp_path / "summary.json")
    monkeypatch.setattr(daily, "utcnow", lambda: NOW)


def test_ambiguous_spotify_id():
    pg = PG()
    pg.tables["tracks"] = pg.tables["tracks"][:2]
    pg.tables["tracks"][1]["spotify_track_id"] = "spotify-A"
    pg.tables["track_daily_stream_overrides"] = []
    assert run(pg, Client([folder(("A", 150))]), max_adds=0) == 0
    assert not pg.tables["track_daily_stream_overrides"]
    observation, = pg.tables["artist_tools_track_streams"]
    assert observation["spotify_track_id"] == "spotify-A"
    assert observation["streams"] == 150
    assert observation["isrc"] is None
    assert json.loads(daily.SUMMARY_PATH.read_text())["ambiguous_spotify_ids"] == {"spotify-A": ["A", "B"]}


def test_current_effective_guard():
    class ReingestedPG(PG):
        def select(self, table, columns, filters):
            if table == "track_daily_streams_effective_public" and f"date=eq.{D}&" in filters:
                self.reads.append((table, columns, filters))
                return [{"isrc": "B", "streams_cumulative": 200}]
            return super().select(table, columns, filters)

    pg = ReingestedPG()
    assert run(pg, Client([folder(("B", 150))]), max_adds=0) == 0
    assert not any(row["isrc"] == "B" for row in pg.tables["track_daily_stream_overrides"])
    assert any(f"date=eq.{D}&" in filters for table, _, filters in pg.reads
               if table == "track_daily_streams_effective_public")


def test_bootstrap_daily_limit():
    pg = PG()
    client = Client([mcp.DailyLimit("artist.tools daily quota reached.")])
    assert run(pg, client) == 0
    summary = json.loads(daily.SUMMARY_PATH.read_text())
    assert summary["rate_limited"] and summary["daily_limited"]
    assert summary["reconcile_daily_limited"] and summary["observation_incomplete"]
    assert summary["error"] is None
    assert [name for name, _ in client.calls] == ["list_dashboard_entities"]


def test_send_time_pacing():
    class SlowRefreshTokens(StubTokens):
        def access_token(self, force_refresh=False):
            if not self.refreshes:
                self.clock += 30  # Refresh delay exceeds the list interval.
            return super().access_token(force_refresh)

    tokens, sends = SlowRefreshTokens(), []

    def post(url, **kwargs):
        sends.append(tokens.clock)
        return Response({"id": kwargs["json"]["id"], "result": {}})

    client = mcp.MCPClient(tokens, SimpleNamespace(post=post), monotonic=lambda: tokens.clock)
    client.initialized = True
    for _ in range(6):
        client.call_tool("list_dashboard_entities", {})
    assert all(second - first >= 12.2 - 1e-9 for first, second in zip(sends, sends[1:]))
    assert sends[-1] - sends[0] >= 60


def test_rotation_retry(monkeypatch):
    """500 AFTER commit must retry the same rotated values, never rotate again."""
    pg = Postgrest("https://db.invalid", "mock-service", backoff_base_s=0)
    state = OAuthPG().row
    attempts = []

    def request(method, url, headers, data, **kwargs):
        values = json.loads(data)
        state.update(values)
        if "refresh_token" in values:
            attempts.append(values)
            if len(attempts) == 1:
                return SimpleNamespace(status_code=500, text="server committed but response failed")
        return Response([dict(state)])

    monkeypatch.setattr(mcp.requests, "request", request)
    session = SimpleNamespace(post=lambda *a, **k: Response({"access_token": "new-access", "refresh_token": "rotated", "expires_in": 3600}))
    with mcp.TokenManager(pg, session=session, now=lambda: NOW, sleep=lambda _: None) as tokens:
        assert tokens.access_token() == "new-access"
    assert len(attempts) == 2 and attempts[0] == attempts[1]
    assert state["refresh_token"] == "rotated"
    assert state["lock_owner"] is None


def test_rotation_recovery(tmp_path, monkeypatch, capsys):
    pg = OAuthPG()
    original = pg._request
    unavailable = [True]

    def request(method, url, headers, data, **kwargs):
        if "refresh_token" in json.loads(data) and unavailable[0]:
            return Response({}, 500)
        if pg.row["lock_owner"] and f"lock_owner.eq.{pg.row['lock_owner']}" in unquote(url):
            # Model the extra atomic lease predicate used for local recovery.
            pg.row.update(json.loads(data))
            return Response([dict(pg.row)])
        return original(method, url, headers, data, **kwargs)

    pg._request = request
    session = SimpleNamespace(post=lambda *a, **k: Response({"access_token": "new-access", "refresh_token": "private-rotated", "expires_in": 3600}))
    with pytest.raises(mcp.ArtistToolsError, match="recovery"):
        with mcp.TokenManager(pg, session=session, now=lambda: NOW, sleep=lambda _: None) as tokens:
            owner = tokens.owner
            tokens.access_token()
    assert pg.row["lock_owner"] == owner
    recovery, = list(tmp_path.rglob("*.json"))
    assert "private-rotated" in recovery.read_text()
    assert not recovery.resolve().is_relative_to(Path.cwd().resolve())
    if os.name != "nt":
        assert stat.S_IMODE(recovery.stat().st_mode) == 0o600
    else:
        # Inspect the actual Windows DACL, not chmod's Unix-style approximation.
        command = ("$acl = Get-Acl -LiteralPath $env:ARTIST_TOOLS_TEST_RECOVERY; "
                   "$ids = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) "
                   "| ForEach-Object { $_.IdentityReference.Value }); "
                   "ConvertTo-Json -Compress -InputObject @{protected=$acl.AreAccessRulesProtected; identities=$ids}")
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                                env={**os.environ, "ARTIST_TOOLS_TEST_RECOVERY": str(recovery)},
                                capture_output=True, text=True, check=True)
        acl = json.loads(result.stdout)
        assert acl["protected"] and acl["identities"] == ["S-1-3-4"]  # OWNER RIGHTS only
    assert "private-rotated" not in capsys.readouterr().out
    unavailable[0] = False

    def never_refresh(*args, **kwargs):
        pytest.fail("Recover the pending rotation before using the old refresh token")

    # Same local machine can recover immediately, even before lease expiry.
    with mcp.TokenManager(pg, session=SimpleNamespace(post=never_refresh), now=lambda: NOW, sleep=lambda _: None) as tokens:
        assert tokens.access_token() == "new-access"
    assert pg.row["refresh_token"] == "private-rotated"
    assert not recovery.exists()
    assert pg.row["lock_owner"] is None


@pytest.mark.parametrize("export_date,dispatch", [(D, True), ("2000-01-01", False), ("", False)])
def test_export_today_dispatch(export_date, dispatch):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("Bash is needed to exercise the GitHub Actions shell step")
    workflow = Path(".github/workflows/sot_daily_export.yml").read_text(encoding="utf-8")
    step = workflow.split("      - name: Start stale-track fix", 1)[1]
    script = step.split("        run: ", 1)[1]
    if script.startswith("|"):
        script = textwrap.dedent(script.split("\n", 1)[1])
    script = script.replace("${{ github.ref_name }}", "perf/artist-tools")
    # Substitute shell functions for both executables: never dispatch to GitHub.
    harness = f'date() {{ printf "%s\\n" "{D}"; }}\ngh() {{ printf "DISPATCH\\n"; }}\n'
    result = subprocess.run([bash, "--noprofile", "--norc", "-c", harness + script],
                            env={**os.environ, "EXPORT_RUN_DATE": export_date,
                                 "GITHUB_REPOSITORY": "test/mock", "GH_TOKEN": "mock",
                                 "BASH_ENV": "", "ENV": ""},
                            capture_output=True, text=True, check=True)
    assert ("DISPATCH" in result.stdout) is dispatch
