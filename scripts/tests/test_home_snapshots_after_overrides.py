"""Exercise real job completion hooks with mocked providers and databases."""
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest

import artist_tools_daily as daily
import artist_tools_stale_repair as manual
import ingest_competitor_exports_to_supabase as competitor
import rapidapi_stale_fix as rapid
from streambase_postgrest import Postgrest
from test_artist_tools_daily import PG, Client, D, Tokens, folder, run

CASCADE = "spotibase_recompute_playlist_daily_stats_cascade"
SNAPSHOT = "refresh_home_diag_snapshots"
NOW = datetime(2026, 10, 10, 10, tzinfo=timezone.utc)


class RepairPG:
    def __init__(self, fail_snapshot=False):
        self.events = []
        self.fail_snapshot = fail_snapshot

    def select(self, table, *_):
        if table == "ingestion_warnings":
            return [{"run_date": D, "details_json": {"affected_tracks": [
                {"isrc": isrc, "streams_cumulative": 100} for isrc in ("A", "B")
            ]}}]
        # Read-only context lookups (history, artist.tools observations) return nothing here.
        assert table in ("user_settings", "track_daily_stream_overrides",
                         "track_daily_streams_effective_public", "artist_tools_track_streams")
        return []

    def upsert(self, table, rows, *_):
        if table == "stream_consolidation_rejects":
            return rows
        assert table == "track_daily_stream_overrides"
        self.events.append(("write", rows))
        return rows

    def rpc(self, name, params, **_):
        if name == "record_stream_source_attempts":
            return None  # source-quality bookkeeping, not part of the write/recompute ordering
        self.events.append((name, params))
        if name == SNAPSHOT and self.fail_snapshot:
            raise RuntimeError("snapshot timeout")
        return "2"


def rapid_job(monkeypatch, fail_snapshot=False, streams=120):
    pg = RepairPG(fail_snapshot)
    for key, value in {
        "SUPABASE_URL": "https://db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "mock-service",
        "BEAT_ANALYTICS_RAPIDAPI_KEY": "mock-provider", "RAPIDAPI_KEY": "",
        "MUSIC_METRICS_RAPIDAPI_KEY": "", "MUSIC_ANALYTICS_RAPIDAPI_KEY": "",
        "CHECKLEAKEDCC_RAPIDAPI_KEY": "",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(rapid, "Postgrest", lambda *_: pg)
    monkeypatch.setattr(rapid, "datetime", SimpleNamespace(now=lambda *_: NOW))
    monkeypatch.setattr(rapid, "usage_for_period", lambda *_: dict.fromkeys(
        ["beat_analytics", "music_metrics", "music_analytics", "checkleakedcc"], 0))
    monkeypatch.setattr(rapid, "attach_spotify_track_ids", lambda _, rows: [
        {**row, "spotify_track_id": f"spotify-{row['isrc']}"} for row in rows])
    monkeypatch.setattr(rapid, "fetch_beat_analytics_streams", lambda *_: streams)
    monkeypatch.setattr(rapid, "record_provider_call", lambda *_: None)
    monkeypatch.setattr(rapid, "enrich_fixed_tracks", lambda _, rows: rows)
    monkeypatch.setattr(rapid.time, "sleep", lambda _: None)
    monkeypatch.setattr(rapid, "OVERRIDE_FLUSH_BATCH_SIZE", 1)
    summaries = []
    monkeypatch.setattr(rapid, "write_summary", lambda *args, **kwargs: (
        pg.events.append(("summary", None)), summaries.append((args, kwargs))))
    rapid.main()
    return pg, summaries


@pytest.mark.parametrize("fail_snapshot", [False, True])
def test_rapidapi_refresh_after_last_write_and_recompute(monkeypatch, capsys, fail_snapshot):
    pg, summaries = rapid_job(monkeypatch, fail_snapshot)
    assert [name for name, _ in pg.events] == ["write", "write", CASCADE, SNAPSHOT, "summary"]
    assert pg.events[-2][1] == {"p_run_date": D}
    assert summaries[0][0][2] == 2
    assert summaries[0][1]["status"] == "completed"
    if fail_snapshot:
        assert "WARN Could not refresh Home diagnostic snapshots (own)" in capsys.readouterr().out


def test_rapidapi_no_successful_write_does_not_refresh(monkeypatch):
    pg, summaries = rapid_job(monkeypatch, streams=None)
    assert [name for name, _ in pg.events] == ["summary"]
    assert summaries[0][0][2] == 0


@pytest.mark.parametrize("fail_snapshot", [False, True])
def test_daily_refresh_after_overrides_and_cascade_preserves_success(tmp_path, monkeypatch, capsys, fail_snapshot):
    lease = {"held": False}
    snapshot_lease_states = []

    @contextmanager
    def tokens(_):
        lease["held"] = True
        try:
            yield Tokens()
        finally:
            lease["held"] = False

    class DailyPG(PG):
        def __init__(self):
            super().__init__()
            self.events = []

        def _request(self, *args, **kwargs):
            response = super()._request(*args, **kwargs)
            if response.json():
                self.events.append(("write", None))
            return response

        def rpc(self, name, params):
            self.events.append((name, params))
            if name == SNAPSHOT:
                snapshot_lease_states.append(lease["held"])
                if fail_snapshot:
                    raise RuntimeError("snapshot timeout")
            return super().rpc(name, params)

    monkeypatch.setattr(daily, "SUMMARY_PATH", tmp_path / "summary.json")
    monkeypatch.setattr(daily, "utcnow", lambda: NOW)
    pg = DailyPG()
    assert daily.run(pg, D, max_adds=0, token_factory=tokens,
                     client_factory=lambda _: Client([folder(("B", 120), ("C", 125))])) == 0
    assert [name for name, _ in pg.events] == ["write", "write", CASCADE, SNAPSHOT]
    assert pg.events[-1][1] == {"p_run_date": D}
    assert snapshot_lease_states == [False]
    summary = json.loads(daily.SUMMARY_PATH.read_text())
    assert summary["status"] == "success" and summary["fixed"] == 2
    if fail_snapshot:
        assert "WARN Could not refresh Home diagnostic snapshots (own)" in capsys.readouterr().out


def test_daily_retry_refreshes_after_recovered_cascade(tmp_path, monkeypatch):
    monkeypatch.setattr(daily, "SUMMARY_PATH", tmp_path / "summary.json")
    monkeypatch.setattr(daily, "utcnow", lambda: NOW)
    pg = PG()
    pg.tables["track_daily_stream_overrides"].append({"date": D, "isrc": "B", "note": "stale-fix: artist.tools auto"})
    assert run(pg, Client([folder(("A", 110), ("B", 120))]), max_adds=0) == 0
    assert pg.rpcs == [(CASCADE, {"p_start_date": D}), (SNAPSHOT, {"p_run_date": D})]


@pytest.mark.parametrize("fail_snapshot", [False, True])
def test_manual_repair_refresh_after_write_and_cascade(tmp_path, monkeypatch, capsys, fail_snapshot):
    pg = RepairPG(fail_snapshot)
    results = tmp_path / "results.json"
    results.write_text(json.dumps([{"isrc": "A", "streams": 120}, {"isrc": "B", "streams": 125}]))
    monkeypatch.setattr(manual, "client", lambda: pg)
    manual.apply(SimpleNamespace(date=D, results=str(results), note="reviewed"))
    assert [name for name, _ in pg.events] == ["write", CASCADE, SNAPSHOT]
    assert pg.events[-1][1] == {"p_run_date": D}
    output = capsys.readouterr().out
    assert '"applied": 2' in output and '"recompute_response": "2"' in output
    if fail_snapshot:
        assert "WARN Could not refresh Home diagnostic snapshots (own)" in output


def test_manual_adapter_uses_shared_transport_preserving_responses(monkeypatch):
    pg = manual.Postgrest("https://db.invalid", "mock-service")
    assert isinstance(pg, Postgrest)
    calls = []
    rows = [{"isrc": "A"}]

    def request(method, url, headers, **kwargs):
        calls.append((method, url, headers, kwargs))
        return SimpleNamespace(status_code=200, text="2", json=lambda: rows)

    monkeypatch.setattr(pg, "_request", request)
    assert pg.select("tracks", {"select": "isrc", "isrc": "in.(A,B)"}) == rows
    assert parse_qs(urlsplit(calls[-1][1]).query) == {"select": ["isrc"], "isrc": ["in.(A,B)"]}
    assert pg.upsert("track_daily_stream_overrides", rows, "date,isrc") == rows
    assert calls[-1][2]["Prefer"] == "resolution=merge-duplicates,return=representation"
    assert calls[-1][3]["idempotent"] is True
    assert pg.rpc(CASCADE, {"p_start_date": D}) == "2"
    assert calls[-1][3]["idempotent"] is True
    assert pg.timeout_s == 180


@pytest.mark.parametrize("fail_snapshot", [False, True])
def test_competitor_refresh_follows_all_override_rpcs_before_revalidation(tmp_path, monkeypatch, capsys, fail_snapshot):
    events = []

    class CompetitorPG:
        def select(self, *_):
            return []

        def select_all(self, table, *_args, **_kwargs):
            return [{"label_key": "a"}, {"label_key": "b"}] if table == "labels" else []

        def insert(self, *_):
            return [{"id": 1}]

        def upsert(self, *_args, **_kwargs):
            pass

        def patch(self, _table, values, _filters):
            events.append((values["status"], None))

        def rpc(self, name, params):
            events.append((name, params))
            if name == "spotibase_stale_summary":
                return []
            if name in ("spotibase_interpolate_stale_streams", "spotibase_rebase_downward_revisions"):
                return [{"overrides_written": 1, "tracks_affected": 1}]
            if name == SNAPSHOT and fail_snapshot:
                raise RuntimeError("snapshot timeout")
            return 1

    pg = CompetitorPG()
    exports = tmp_path / "2026" / "10" / "10"
    exports.mkdir(parents=True)
    monkeypatch.setenv("SUPABASE_URL", "https://db.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "mock-service")
    monkeypatch.setattr(competitor, "Postgrest", lambda *_args, **_kwargs: pg)
    monkeypatch.setattr(competitor, "load_stream_payout_usd", lambda _: 0.002)
    monkeypatch.setattr(competitor, "load_playlists_csv", lambda _: [])
    monkeypatch.setattr(competitor, "notify_web_revalidate", lambda: events.append(("revalidate", None)))
    monkeypatch.setattr("sys.argv", ["ingest", "--run-date", D, "--exports-dir", str(tmp_path)])
    competitor.main()
    names = [name for name, _ in events]
    first_snapshot = names.index(SNAPSHOT)
    for name in ("spotibase_reconcile_auto_overrides", "spotibase_interpolate_stale_streams",
                 "spotibase_rebase_downward_revisions", CASCADE, "success"):
        assert names.index(name) < first_snapshot
    assert names[-1] == "revalidate"
    assert [params["p_label_key"] for name, params in events if name == SNAPSHOT] == [None, "a", "b"]
    if fail_snapshot:
        assert capsys.readouterr().out.count("WARN Could not refresh Home diagnostic snapshots") == 3
