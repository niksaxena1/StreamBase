"""Stored artist.tools reads made before the cut-off hour hold yesterday's counts and must not feed repairs."""
import inspect

import artist_tools_daily
import rapidapi_stale_fix


class RecordingPg:
    def __init__(self):
        self.queries = []

    def select(self, table, columns, query, **_):
        self.queries.append((table, query))
        return [{"isrc": "aa1", "streams": 150}]


def test_second_look_reads_only_late_observations():
    pg = RecordingPg()
    out = rapidapi_stale_fix.load_artist_tools_observations(pg, "2026-11-26", ["AA1"])
    assert out == {"AA1": 150}
    table, query = pg.queries[0]
    assert table == "artist_tools_track_streams"
    assert "date=eq.2026-11-26" in query
    assert "observed_at=gte.2026-11-26T15:00:00Z" in query


def test_cutoff_hour_matches_daily_job_default():
    default = inspect.signature(artist_tools_daily.run).parameters["observe_after_hour"].default
    assert rapidapi_stale_fix.ARTIST_TOOLS_OBSERVE_AFTER_HOUR == default == 15


def test_daily_repair_reads_only_late_observations():
    source = inspect.getsource(artist_tools_daily)
    assert "date=eq.{run_date}&observed_at=gte.{cutoff}" in source
