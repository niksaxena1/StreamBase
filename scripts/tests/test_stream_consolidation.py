"""Consolidation rules (floor, 5x cap, best-of, provenance) and the stale-fix second look."""
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import rapidapi_stale_fix as rapid
import stream_consolidation as sc

RUN = date(2026, 10, 14)
NOW = datetime(2026, 10, 14, 11, 30, tzinfo=timezone.utc)


def hist(values, end=RUN - timedelta(days=1)):
    """values oldest -> newest, last one on `end`."""
    start = end - timedelta(days=len(values) - 1)
    return [(start + timedelta(days=i), v) for i, v in enumerate(values)]


# --- history_stats -----------------------------------------------------------------------------

def test_history_stats_prev_avg_and_flat_run():
    prev, avg, flat = sc.history_stats(hist([1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]), RUN)
    assert prev == 1700
    assert avg == pytest.approx(100)
    assert flat == 0


def test_history_stats_ignores_flat_days_in_average_and_counts_flat_run():
    prev, avg, flat = sc.history_stats(hist([1000, 1100, 1200, 1300, 1400, 1400, 1400, 1400]), RUN)
    assert prev == 1400
    assert avg == pytest.approx(100)  # mean of the positive gains only
    assert flat == 3


def test_history_stats_missing_previous_day():
    prev, avg, flat = sc.history_stats(hist([1000, 1100], end=RUN - timedelta(days=3)), RUN)
    assert prev is None
    assert avg == pytest.approx(100)
    assert flat == 0


def test_history_stats_without_history():
    assert sc.history_stats([], RUN) == (None, None, 0)


# --- cap ---------------------------------------------------------------------------------------

def test_cap_is_five_times_typical_gain_over_previous_day():
    ctx = sc.Context(stale_value=10_000, prev_value=10_000, avg_daily_gain=2_000)
    assert sc.gain_cap(ctx) == 10_000 + 5 * 2_000


def test_cap_has_minimum_allowance_for_tiny_tracks():
    ctx = sc.Context(stale_value=500, prev_value=500, avg_daily_gain=3)
    assert sc.gain_cap(ctx) == 500 + 5 * sc.MIN_DAILY_GAIN_ALLOWANCE


def test_cap_grows_with_flat_run_because_a_multi_day_stale_catches_up_at_once():
    ctx = sc.Context(stale_value=10_000, prev_value=10_000, avg_daily_gain=2_000, flat_run=2)
    assert sc.gain_cap(ctx) == 10_000 + 5 * 2_000 * 3


def test_cap_unknown_without_previous_day():
    assert sc.gain_cap(sc.Context(stale_value=10)) is None


# --- floors and rejects ------------------------------------------------------------------------

CTX = sc.Context(stale_value=10_000, prev_value=10_000, avg_daily_gain=1_000)  # cap = 15_000


@pytest.mark.parametrize(
    "value,reason",
    [
        (None, None),
        (-5, sc.REASON_INVALID),
        (10_000, sc.REASON_NOT_ABOVE_CURRENT),
        (9_000, sc.REASON_NOT_ABOVE_CURRENT),
        (15_001, sc.REASON_JUMP_OVER_CAP),
        (15_000, None),
        (10_001, None),
    ],
)
def test_check_candidate(value, reason):
    reject = sc.check_candidate("Beat Analytics", value, CTX)
    if value is None:
        assert reject is not None and reject.reason == sc.REASON_INVALID
    elif reason is None:
        assert reject is None
    else:
        assert reject.reason == reason


def test_value_below_previous_day_is_rejected_even_when_above_a_dropped_current_value():
    ctx = sc.Context(stale_value=8_000, prev_value=10_000, avg_daily_gain=1_000)
    assert sc.check_candidate("X", 9_000, ctx).reason == sc.REASON_BELOW_PREVIOUS


def test_without_previous_day_only_the_current_value_floor_applies():
    ctx = sc.Context(stale_value=100)
    assert sc.check_candidate("X", 101, ctx) is None
    assert sc.check_candidate("X", 100, ctx).reason == sc.REASON_NOT_ABOVE_CURRENT


# --- best of all sources -----------------------------------------------------------------------

def test_highest_plausible_candidate_wins_and_implausible_ones_are_logged():
    decision = sc.consolidate(
        [("Beat Analytics", 12_000), ("artist.tools", 11_000), ("CheckLeakedCC", 900_000)], CTX
    )
    assert (decision.source, decision.value) == ("Beat Analytics", 12_000)
    assert decision.plausible == [("Beat Analytics", 12_000), ("artist.tools", 11_000)]
    assert [(r.source, r.reason) for r in decision.rejects] == [("CheckLeakedCC", sc.REASON_JUMP_OVER_CAP)]
    assert decision.rejects[0].cap_value == 15_000


def test_tie_goes_to_earlier_source():
    decision = sc.consolidate([("Beat Analytics", 12_000), ("Music Metrics", 12_000)], CTX)
    assert decision.source == "Beat Analytics"


def test_nothing_plausible_is_not_accepted():
    decision = sc.consolidate([("Beat Analytics", 5), ("Music Metrics", None)], CTX)
    assert not decision.accepted and decision.value is None
    assert [r.source for r in decision.rejects] == ["Beat Analytics"]


def test_provenance_note_keeps_stale_fix_prefix():
    decision = sc.consolidate([("Beat Analytics", 12_000), ("artist.tools", 11_000)], CTX)
    assert sc.provenance_note(decision) == "stale-fix: Beat Analytics auto; best-of=Beat Analytics:12000,artist.tools:11000"
    single = sc.consolidate([("Music Metrics", 12_000)], CTX)
    assert sc.provenance_note(single) == "stale-fix: Music Metrics auto"
    assert sc.provenance_note(single, second_look=True) == "stale-fix: Music Metrics auto; second-look"


# --- rapidapi_stale_fix.main: manual wins, rejects logged, second look --------------------------

class FakePG:
    def __init__(self, overrides=(), history=None, obs=()):
        self.overrides = list(overrides)  # [{"isrc", "note"}]
        self.history = history or {}
        self.obs = list(obs)
        self.writes = []
        self.rpcs = []
        self.rejects = []

    def select(self, table, columns, filters=""):
        if table == "user_settings":
            return []
        if table == "ingestion_warnings":
            return [{"run_date": RUN.isoformat(), "details_json": {"affected_tracks": [
                {"isrc": i, "streams_cumulative": v} for i, v in (("A", 10_000), ("B", 10_000), ("C", 10_000))]}}]
        if table == "track_daily_stream_overrides":
            if "note=like" in filters:
                return [o for o in self.overrides if str(o["note"]).startswith("stale-fix:")]
            return list(self.overrides)
        if table == "track_daily_streams_effective_public":
            return [{"isrc": i, "date": d.isoformat(), "streams_cumulative": v}
                    for i, pts in self.history.items() for d, v in pts]
        if table == "artist_tools_track_streams":
            return list(self.obs)
        raise AssertionError(table)

    def upsert(self, table, rows, _on):
        if table == "track_daily_stream_overrides":
            self.writes.extend(rows)
        elif table == "stream_consolidation_rejects":
            self.rejects.extend(rows)
        return rows

    def rpc(self, name, params=None, **_):
        self.rpcs.append((name, params))
        return 1


def run_main(monkeypatch, pg, provider_values, second_look=False):
    for key, value in {
        "SUPABASE_URL": "https://db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "mock-service",
        "BEAT_ANALYTICS_RAPIDAPI_KEY": "k", "MUSIC_METRICS_RAPIDAPI_KEY": "k",
        "RAPIDAPI_KEY": "", "MUSIC_ANALYTICS_RAPIDAPI_KEY": "", "CHECKLEAKEDCC_RAPIDAPI_KEY": "",
        "SECOND_LOOK": "true" if second_look else "",
    }.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(rapid, "Postgrest", lambda *_: pg)
    monkeypatch.setattr(rapid, "datetime", SimpleNamespace(now=lambda *_: NOW))
    monkeypatch.setattr(rapid, "usage_for_period", lambda *_: dict.fromkeys(
        ["beat_analytics", "music_metrics", "music_analytics", "checkleakedcc"], 0))
    monkeypatch.setattr(rapid, "attach_spotify_track_ids", lambda _, rows: [
        {**row, "spotify_track_id": f"sp-{row['isrc']}"} for row in rows])
    monkeypatch.setattr(rapid, "fetch_beat_analytics_streams", lambda sid, _k: provider_values["beat"][sid[3:]])
    monkeypatch.setattr(rapid, "fetch_music_metrics_streams", lambda isrc, _k: provider_values["mm"].get(isrc))
    monkeypatch.setattr(rapid, "record_provider_call", lambda *_: None)
    monkeypatch.setattr(rapid, "enrich_fixed_tracks", lambda _, rows: rows)
    monkeypatch.setattr(rapid, "refresh_own_home_snapshots", lambda *_: None)
    monkeypatch.setattr(rapid.time, "sleep", lambda _: None)
    summaries = []
    monkeypatch.setattr(rapid, "write_summary", lambda *a, **k: summaries.append((a, k)))
    rapid.main()
    return summaries


FLAT_HISTORY = {
    isrc: hist([8_000, 9_000, 10_000, 10_000], end=RUN) for isrc in ("A", "B", "C")
}
GROWING = {isrc: hist([6_000, 7_000, 8_000, 9_000, 10_000]) for isrc in ("A", "B", "C")}


def test_manual_override_is_never_touched_and_implausible_jump_falls_through(monkeypatch):
    pg = FakePG(overrides=[{"isrc": "A", "note": "Manual fix"}], history=GROWING)
    values = {"beat": {"B": 400_000, "C": 10_500}, "mm": {"B": 10_900}}
    run_main(monkeypatch, pg, values)
    written = {w["isrc"]: w for w in pg.writes}
    assert "A" not in written  # manual wins
    assert written["B"]["streams_cumulative_override"] == 10_900  # Beat rejected (>cap), Music Metrics used
    assert written["B"]["note"] == "stale-fix: Music Metrics auto"
    assert written["C"]["streams_cumulative_override"] == 10_500
    assert [(r["isrc"], r["source"], r["reason"]) for r in pg.rejects] == [("B", "Beat Analytics", "jump_over_cap")]
    quality = {p["p_source"]: p for n, p in pg.rpcs if n == "record_stream_source_attempts"}
    assert quality["Beat Analytics"]["p_attempts"] == 2 and quality["Beat Analytics"]["p_rejects"] == 1
    assert quality["Music Metrics"]["p_attempts"] == 1


def test_never_lowers_value(monkeypatch):
    pg = FakePG(history=GROWING)
    run_main(monkeypatch, pg, {"beat": {"A": 9_500, "B": 9_999, "C": 10_000}, "mm": {}})
    assert pg.writes == []
    assert len(pg.rejects) == 3 and {r["reason"] for r in pg.rejects} == {"not_above_current"}


def test_artist_tools_observation_competes_and_best_of_is_recorded(monkeypatch):
    pg = FakePG(history=GROWING, obs=[{"isrc": "A", "streams": 11_800}])
    run_main(monkeypatch, pg, {"beat": {"A": 11_000, "B": 10_500, "C": 10_400}, "mm": {}})
    a = next(w for w in pg.writes if w["isrc"] == "A")
    assert a["streams_cumulative_override"] == 11_800
    assert a["note"] == "stale-fix: artist.tools auto; best-of=artist.tools:11800,Beat Analytics:11000"


def test_second_look_skips_overridden_and_recovered_tracks_and_marks_note(monkeypatch):
    # A: artist.tools already repaired; B: ingestion moved on (no longer stale); C: still stale.
    history = {
        "A": hist([9_000, 10_000, 10_000], end=RUN),
        "B": hist([9_000, 10_000, 10_800], end=RUN),
        "C": hist([9_000, 10_000, 10_000], end=RUN),
    }
    pg = FakePG(overrides=[{"isrc": "A", "note": "stale-fix: artist.tools auto"}], history=history)
    calls = []
    values = {"beat": {"B": 99, "C": 10_700}, "mm": {}}
    orig = values["beat"]
    values["beat"] = type("D", (dict,), {"__getitem__": lambda self, k: (calls.append(k), orig[k])[1]})(orig)
    summaries = run_main(monkeypatch, pg, values, second_look=True)
    assert calls == ["C"]
    assert [w["isrc"] for w in pg.writes] == ["C"]
    assert pg.writes[0]["note"] == "stale-fix: Beat Analytics auto; second-look"
    assert summaries[-1][1]["second_look"] is True
