"""Catch-up smoothing wiring: summary printed, warn-and-continue, cascade from earliest day."""
from datetime import date

import ingest_competitor_exports_to_supabase as competitor
from streambase_catchup import NEEDS_REVIEW_CODE, run_catchup_smoothing, smooth_own_catalog

RUN = date(2026, 10, 11)
CASCADE = "spotibase_recompute_playlist_daily_stats_cascade"
SMOOTH = "spotibase_smooth_catchups"


def applied_row(catchup_date="2026-10-10", first_date="2026-10-08", smoothed=120):
    return {
        "catchup_date": catchup_date,
        "tracks_smoothed": smoothed,
        "streams_moved": 5000,
        "tracks_eligible": 400,
        "applied": True,
        "status": "applied",
        "first_date": first_date,
        "catalog_tracks": 500,
    }


def review_row():
    return {
        "catchup_date": "2026-10-10",
        "tracks_smoothed": 300,
        "streams_moved": 90000,
        "tracks_eligible": 400,
        "applied": False,
        "status": "mass_guard",
        "first_date": "2026-10-08",
        "catalog_tracks": 500,
    }


class FakePG:
    def __init__(self, responses=None, fail=()):
        self.responses = responses or {}
        self.fail = set(fail)
        self.calls = []
        self.inserts = []

    def rpc(self, name, params=None):
        self.calls.append((name, params))
        if name in self.fail:
            raise RuntimeError(f"{name} boom")
        return self.responses.get(name, 0)

    def insert(self, table, rows):
        if "insert" in self.fail:
            raise RuntimeError("insert boom")
        self.inserts.append((table, rows))
        return rows


def test_calls_smoothing_for_run_date_non_dry_run_and_prints_summary(capsys):
    pg = FakePG({SMOOTH: [applied_row()]})
    result = run_catchup_smoothing(pg, RUN, universe="competitor")

    assert pg.calls == [(SMOOTH, {"p_end_date": "2026-10-11", "p_lookback_days": 7, "p_dry_run": False})]
    assert result["earliest"] == date(2026, 10, 8)
    out = capsys.readouterr().out
    assert "competitor catch-up smoothing 2026-10-10" in out
    assert "tracks_smoothed=120" in out and "applied=True" in out


def test_earliest_is_minimum_over_applied_dates_only():
    rows = [applied_row("2026-10-09", "2026-10-07"), applied_row("2026-10-11", "2026-10-09"), review_row()]
    result = run_catchup_smoothing(FakePG({SMOOTH: rows}), RUN, universe="own")
    assert result["earliest"] == date(2026, 10, 7)
    assert len(result["applied_rows"]) == 2


def test_rpc_failure_warns_and_continues(capsys):
    pg = FakePG(fail={SMOOTH})
    result = run_catchup_smoothing(pg, RUN, universe="own")
    assert result["earliest"] is None and result["error"]
    assert "WARN Could not run own catch-up smoothing" in capsys.readouterr().out


def test_mass_guard_adds_catchup_needs_review_warning():
    pg = FakePG({SMOOTH: [review_row()]})
    result = run_catchup_smoothing(pg, RUN, run_id=42, universe="competitor")

    assert result["earliest"] is None
    assert len(pg.inserts) == 1
    table, rows = pg.inserts[0]
    assert table == "ingestion_warnings"
    assert rows[0]["code"] == NEEDS_REVIEW_CODE == "catchup_needs_review"
    assert rows[0]["severity"] == "warn"
    assert rows[0]["run_id"] == 42 and rows[0]["run_date"] == "2026-10-11"


def test_warning_insert_failure_is_swallowed(capsys):
    pg = FakePG({SMOOTH: [review_row()]}, fail={"insert"})
    result = run_catchup_smoothing(pg, RUN, run_id=1)
    assert result["review_rows"]
    assert "Could not record catchup_needs_review" in capsys.readouterr().out


def test_empty_result_does_nothing():
    pg = FakePG({SMOOTH: []})
    result = run_catchup_smoothing(pg, RUN, run_id=1)
    assert result["earliest"] is None and not pg.inserts


def test_own_catalog_cascades_from_earliest_smoothed_date():
    pg = FakePG({SMOOTH: [applied_row(first_date="2026-10-08")], "spotibase_reconcile_auto_overrides": 0})
    result = smooth_own_catalog(pg, RUN, run_id="run-1")

    names = [name for name, _ in pg.calls]
    assert names == ["spotibase_reconcile_auto_overrides", SMOOTH, CASCADE]
    assert pg.calls[-1] == (CASCADE, {"p_start_date": "2026-10-08", "p_end_date": "2026-10-11"})
    assert result["recompute_start"] == date(2026, 10, 8)


def test_own_catalog_no_cascade_when_nothing_changed():
    pg = FakePG({SMOOTH: [], "spotibase_reconcile_auto_overrides": 0})
    smooth_own_catalog(pg, RUN)
    assert CASCADE not in [name for name, _ in pg.calls]


def test_own_catalog_reconcile_deletions_trigger_cascade_from_lookback():
    pg = FakePG({SMOOTH: [], "spotibase_reconcile_auto_overrides": 3})
    smooth_own_catalog(pg, RUN)
    assert pg.calls[-1] == (CASCADE, {"p_start_date": "2026-09-27", "p_end_date": "2026-10-11"})


def test_own_catalog_failures_do_not_raise(capsys):
    pg = FakePG({SMOOTH: [applied_row()]}, fail={"spotibase_reconcile_auto_overrides", CASCADE})
    result = smooth_own_catalog(pg, RUN)
    out = capsys.readouterr().out
    assert "Could not reconcile auto-catchup overrides" in out
    assert "Could not recompute playlist stats after catch-up smoothing" in out
    assert result["earliest"] == date(2026, 10, 8)


def test_competitor_normalization_runs_smoothing_after_interpolation_and_cascades_from_earliest():
    class CompetitorPG(FakePG):
        def rpc(self, name, params=None):
            super().rpc(name, params)
            if name == "spotibase_interpolate_stale_streams":
                return [{"overrides_written": 0, "tracks_affected": 0}]
            if name == "spotibase_rebase_downward_revisions":
                return [{"overrides_written": 0, "tracks_affected": 0}]
            if name == SMOOTH:
                return [applied_row(first_date="2026-10-08")]
            if name == CASCADE:
                return 4
            return 0

    pg = CompetitorPG()
    result = competitor.normalize_competitor_analytics(pg, RUN, run_id=7)

    names = [name for name, _ in pg.calls]
    assert names.index(SMOOTH) > names.index("spotibase_rebase_downward_revisions")
    assert names.index(SMOOTH) < names.index(CASCADE)
    assert (CASCADE, {"p_start_date": "2026-10-08", "p_end_date": "2026-10-11"}) in pg.calls
    assert result["recompute_start"] == "2026-10-08"
    assert result["catchup_tracks_smoothed"] == 120


def test_competitor_normalization_continues_when_smoothing_fails(capsys):
    class CompetitorPG(FakePG):
        def rpc(self, name, params=None):
            super().rpc(name, params)
            if name == SMOOTH:
                raise RuntimeError("smooth down")
            if name == CASCADE:
                return 1
            return 0

    pg = CompetitorPG()
    result = competitor.normalize_competitor_analytics(pg, RUN, run_id=7)

    assert result["recompute_start"] == "2026-10-11"
    assert CASCADE in [name for name, _ in pg.calls]
    assert "WARN Could not run competitor catch-up smoothing" in capsys.readouterr().out
