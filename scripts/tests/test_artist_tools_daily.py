from contextlib import nullcontext
from datetime import datetime, timezone
import json
from types import SimpleNamespace

import pytest

import artist_tools_daily as daily
from artist_tools_mcp import ArtistToolsError, DailyLimit, LeaseBusy

D = "2026-10-10"


def track(isrc, streams=100):
    return {"isrc": isrc, "spotify_track_id": "spotify-" + isrc,
            "name": "Track " + isrc, "latest": [{"streams_cumulative": streams}]}


def warning(*isrcs):
    return {"run_date": D, "details_json": {"affected_tracks": [
        {"isrc": isrc, "streams_cumulative": 100} for isrc in isrcs]}}


def test_priority_today_then_90_day_frequency_then_latest_streams():
    tracks = [track("high", 9999), track("today", 1), track("frequent", 2),
              track("occasional", 999), track("low", 3), track("saved", 10000)]
    warnings = [warning("frequent", "occasional"), warning("frequent")]
    result = daily.priority_tracks(tracks, warning("today")["details_json"]["affected_tracks"], warnings, {"spotify-saved"})
    assert [row["isrc"] for row in result] == ["today", "frequent", "occasional", "high", "low"]


@pytest.mark.parametrize("observed,previous,existing,expected", [
    (101, 100, set(), True), (101, 101, set(), True),
    (100, 99, set(), False), (99, 98, set(), False),
    (101, 102, set(), False), (101, None, set(), False),
    (None, 100, set(), False), (101, 100, {"A"}, False),
])
def test_override_sanity_no_decrease_or_overwrite(observed, previous, existing, expected):
    rows = daily.override_rows(D, [{"isrc": " a ", "streams_cumulative": 100}],
                               {"A": observed}, {"A": previous}, existing)
    assert bool(rows) is expected
    if rows:
        assert rows == [{"date": D, "isrc": "A", "streams_cumulative_override": 101,
                         "note": "stale-fix: artist.tools auto"}]


@pytest.mark.parametrize("count,expected", [(499, 499), (500, 0), (501, 0)])
def test_threshold_applies_to_whole_stale_warning(count, expected):
    stale = [{"isrc": str(i), "streams_cumulative": 100} for i in range(count)]
    observed = {str(i): 101 for i in range(count)}
    previous = {str(i): 100 for i in range(count)}
    assert len(daily.override_rows(D, stale, observed, previous, set())) == expected


class PG:
    base, h = "https://db.invalid/rest/v1", {"apikey": "test"}

    def __init__(self):
        self.tables = {"tracks": [track("A"), track("B"), track("C")],
                       "ingestion_warnings": [warning("A", "B", "C")],
                       "artist_tools_saved_tracks": [], "artist_tools_track_streams": [],
                       "artist_tools_runs": [],
                       "user_settings": [],
                       "track_daily_streams_effective_public": [{"isrc": i, "streams_cumulative": 100} for i in ("A", "B", "C")],
                       "track_daily_stream_overrides": [{"date": D, "isrc": "A", "streams_cumulative_override": 110,
                                                         "note": "stale-fix: Beat Analytics auto"}]}
        self.writes, self.rpcs, self.reads = [], [], []
        self.concurrent_override = None

    def select(self, table, columns, filters):
        self.reads.append((table, columns, filters))
        rows = self.tables[table]
        if table == "artist_tools_runs":
            return [row for row in rows if row["status"] == "success"]
        return rows

    def select_all(self, table, columns, filters, **kwargs):
        return self.select(table, columns, filters)

    def upsert(self, table, rows, on_conflict):
        self.writes.append((table, rows, on_conflict))
        keys = on_conflict.split(",")
        for row in rows:
            match = next((old for old in self.tables[table] if all(old.get(key) == row.get(key) for key in keys)), None)
            if match is not None:
                match.update(row)
            else:
                self.tables[table].append(dict(row))

    def _request(self, method, url, headers, data, **kwargs):
        assert method == "POST" and url.endswith("?on_conflict=date,isrc")
        assert headers["Prefer"] == "resolution=ignore-duplicates,return=representation"
        rows = json.loads(data)
        if self.concurrent_override:
            self.tables["track_daily_stream_overrides"].append(self.concurrent_override)
        existing = {row["isrc"] for row in self.tables["track_daily_stream_overrides"]}
        inserted = [row for row in rows if row["isrc"] not in existing]
        self.tables["track_daily_stream_overrides"].extend(inserted)
        return SimpleNamespace(status_code=201, json=lambda: inserted)

    def rpc(self, name, params):
        self.rpcs.append((name, params))


class Tokens:
    def access_token(self):
        return "test-access"

    def heartbeat(self):
        pass


class Client:
    rate_limited = False
    daily_limited = False

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def call_tool(self, name, args):
        self.calls.append((name, args))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            if isinstance(result, DailyLimit):
                self.rate_limited = self.daily_limited = True
            raise result
        return result


def folder(*pairs):
    return {"result": {"totalCount": len(pairs), "items": [{"spotifyId": "spotify-" + i, "streams": n} for i, n in pairs]}}


@pytest.fixture(autouse=True)
def summary_path(tmp_path, monkeypatch):
    monkeypatch.setattr(daily, "SUMMARY_PATH", tmp_path / "summary.json")
    monkeypatch.setattr(daily, "utcnow", lambda: datetime(2026, 10, 10, 10, tzinfo=timezone.utc))


def run(pg, client, **kwargs):
    return daily.run(pg, D, token_factory=lambda _: nullcontext(Tokens()), client_factory=lambda _: client, **kwargs)


def test_end_to_end_reconciles_adds_observes_without_overwriting_rapidapi():
    pg = PG()
    client = Client([folder(("A", 115)), {"result": {"added": True}}, {"result": {"added": True}},
                     folder(("A", 115), ("B", 120), ("C", 125))])
    assert run(pg, client) == 0
    assert [name for name, _ in client.calls] == ["list_dashboard_entities", "add_entity_to_folder",
                                                 "add_entity_to_folder", "list_dashboard_entities"]
    assert len(pg.tables["artist_tools_saved_tracks"]) == 3
    assert len(pg.tables["artist_tools_track_streams"]) == 3
    overrides = pg.tables["track_daily_stream_overrides"]
    assert overrides[0]["streams_cumulative_override"] == 110
    assert overrides[0]["note"] == "stale-fix: Beat Analytics auto"
    assert len(overrides) == 3
    assert pg.rpcs == [("spotibase_recompute_playlist_daily_stats_cascade", {"p_start_date": D})]
    summary = json.loads(daily.SUMMARY_PATH.read_text())
    assert (summary["added"], summary["observed"], summary["fixed"], summary["remaining_unsaved"]) == (2, 3, 2, 0)
    assert pg.tables["artist_tools_runs"][0]["status"] == "success"
    assert pg.writes[0][1][0]["status"] == "running"
    assert all("competitor" not in table for table, _, _ in pg.reads)
    history_filter = next(filters for table, _, filters in pg.reads if table == "ingestion_warnings" and "gte" in filters)
    assert "run_date=gte.2026-07-13" in history_filter


def test_daily_add_quota_is_clean_stop_and_observation_continues():
    pg = PG()
    pg.tables["artist_tools_saved_tracks"] = [{"spotify_track_id": "spotify-A"}]
    client = Client([DailyLimit("artist.tools daily quota reached."), folder(("A", 110), ("B", 120))])
    assert run(pg, client) == 0
    summary = json.loads(daily.SUMMARY_PATH.read_text())
    assert summary["add_daily_limited"] and summary["rate_limited"] and summary["daily_limited"]
    assert summary["added"] == 0 and summary["observed"] == 2 and summary["remaining_unsaved"] == 2
    assert summary["error"] is None


def test_skip_if_done_never_creates_client_or_touches_credentials():
    pg = PG()
    pg.tables["artist_tools_runs"] = [{"status": "success", "run_date": D}]

    def forbidden(*args):
        pytest.fail("Skip must not touch OAuth/MCP")

    assert daily.run(pg, D, skip_if_done=True, token_factory=forbidden, client_factory=forbidden) == 0
    assert not pg.writes
    assert json.loads(daily.SUMMARY_PATH.read_text())["skipped"]


def test_skip_rechecked_inside_lease():
    pg = PG()

    def acquired(_):
        pg.tables["artist_tools_runs"] = [{"status": "success", "run_date": D}]
        return nullcontext(Tokens())

    assert daily.run(pg, D, skip_if_done=True, token_factory=acquired) == 0
    assert not pg.writes


def test_invalid_grant_marks_run_failed_and_summary_clear():
    pg = PG()

    class BrokenTokens:
        def access_token(self):
            raise ArtistToolsError("artist.tools invalid_grant: re-run authorize")

        def heartbeat(self):
            pass

    assert daily.run(pg, D, token_factory=lambda _: nullcontext(BrokenTokens()), client_factory=lambda _: Client([])) == 1
    assert pg.tables["artist_tools_runs"][0]["status"] == "failed"
    assert "re-run authorize" in json.loads(daily.SUMMARY_PATH.read_text())["error"]


def test_lease_contention_does_not_modify_run_row():
    pg = PG()
    pg.tables["artist_tools_runs"] = [{"status": "running", "run_date": D}]

    def busy(_):
        raise LeaseBusy("Another runner holds the artist.tools lease")

    assert daily.run(pg, D, token_factory=busy) == 1
    assert not pg.writes
    assert pg.tables["artist_tools_runs"][0]["status"] == "running"


def test_override_insert_does_not_overwrite_concurrent_rapidapi_fix():
    pg = PG()
    pg.concurrent_override = {"date": D, "isrc": "B", "note": "stale-fix: Music Metrics auto", "streams_cumulative_override": 150}
    assert daily.write_overrides(pg, [{"date": D, "isrc": "B", "note": "stale-fix: artist.tools auto",
                                      "streams_cumulative_override": 120}]) == []
    assert pg.tables["track_daily_stream_overrides"][-1]["streams_cumulative_override"] == 150


def test_cascade_recovery_after_previous_failed_run():
    pg = PG()
    pg.tables["track_daily_stream_overrides"].append({"date": D, "isrc": "B", "note": "stale-fix: artist.tools auto"})
    assert run(pg, Client([folder(("A", 110), ("B", 120))]), max_adds=0) == 0
    assert len(pg.rpcs) == 1


def test_folder_pagination_and_limit():
    first = {"result": {"totalCount": 101, "items": [{"spotifyId": "other"}] * 100}}
    second = {"result": {"totalCount": 101, "items": [{"spotifyId": "last"}]}}
    client = Client([first, second])
    assert len(list(daily.folder_pages(client))) == 2
    assert [args["page"] for _, args in client.calls] == [1, 2]
    assert all(args["limit"] == 100 for _, args in client.calls)
    too_many = {"result": {"totalCount": 10001, "items": [{"spotifyId": "other"}] * 100}}
    with pytest.raises(ArtistToolsError, match="100-page"):
        list(daily.folder_pages(Client([too_many] * 100)))


def test_observation_daily_limit_preserves_partial_rows():
    pg = PG()
    first = {"result": {"totalCount": 101, "items": [{"spotifyId": "spotify-B", "streams": 120}]}}
    assert run(pg, Client([first, DailyLimit("artist.tools daily quota reached.")]), max_adds=0) == 0
    summary = json.loads(daily.SUMMARY_PATH.read_text())
    assert summary["observation_incomplete"] and summary["observe_daily_limited"]
    assert summary["fixed"] == 1 and summary["observed"] == 1


def test_max_adds_and_unrelated_folder_items():
    pg = PG()
    client = Client([folder(("unrelated", 999)), {"result": {"added": True}}, folder(("A", 120), ("unrelated", 999))])
    assert run(pg, client, max_adds=1) == 0
    assert len(pg.tables["artist_tools_track_streams"]) == 1
    assert len(pg.tables["artist_tools_saved_tracks"]) == 2
    assert {name for name, _ in client.calls} == {"add_entity_to_folder", "list_dashboard_entities"}
    assert json.loads(daily.SUMMARY_PATH.read_text())["remaining_unsaved"] == 2


def test_hard_error_never_logs_raw_secret(capsys):
    pg = PG()
    assert run(pg, Client([RuntimeError("secret-token")]), max_adds=0) == 1
    assert "secret-token" not in capsys.readouterr().out
    assert "secret-token" not in daily.SUMMARY_PATH.read_text()


@pytest.mark.parametrize("value", [False, -1, 12.5, "garbage"])
def test_invalid_counts_fail(value):
    assert run(PG(), Client([folder(("B", value))]), max_adds=0) == 1


def test_historical_cli_date_is_rejected_before_database(monkeypatch):
    monkeypatch.setattr(daily, "database_from_env", lambda: pytest.fail("Historical invocation must not touch DB"))
    with pytest.raises(SystemExit) as error:
        daily.main(["run", "--date", "2000-01-01"])
    assert error.value.code == 2


def test_disabled_auto_fix_still_observes_but_never_writes_overrides():
    pg = PG()
    pg.tables["user_settings"] = [{"rapidapi_auto_fix_enabled": False}]
    assert run(pg, Client([folder(("A", 110), ("B", 120))]), max_adds=0) == 0
    assert len(pg.tables["artist_tools_track_streams"]) == 2
    assert len(pg.tables["track_daily_stream_overrides"]) == 1
    assert not pg.rpcs
    assert json.loads(daily.SUMMARY_PATH.read_text())["auto_fix_disabled"]


def test_midnight_rollover_never_mislabels_observation(monkeypatch):
    pg = PG()
    monkeypatch.setattr(daily, "utcnow", lambda: datetime(2026, 10, 11, 0, tzinfo=timezone.utc))
    assert run(pg, Client([folder(("B", 120))]), max_adds=0) == 1
    assert not pg.tables["artist_tools_track_streams"]
    assert "UTC date changed" in json.loads(daily.SUMMARY_PATH.read_text())["error"]
