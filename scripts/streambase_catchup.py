"""Automatic catch-up smoothing step shared by the own-catalog and competitor ingests.

SpotOnTrack occasionally delivers stale / partially updated counters followed by a
catch-up day. ``<schema>.spotibase_smooth_catchups`` (see
supabase/migrations/20261011195504_add_auto_catchup_smoothing.sql) detects that
pattern and writes even-split overrides (note ``auto-catchup:v1``). This module is
the thin, failure-tolerant caller: it never raises, prints the summary and reports
what the caller must recompute.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

CATCHUP_LOOKBACK_DAYS = 7
NEEDS_REVIEW_CODE = "catchup_needs_review"


def _parse_date(raw: Any) -> Optional[date]:
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str) and raw:
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            return None
    return None


def run_catchup_smoothing(
    pg: Any,
    run_date: date,
    *,
    run_id: Any = None,
    universe: str = "own",
) -> Dict[str, Any]:
    """Apply catch-up smoothing for ``run_date`` and return what changed.

    Returns ``{"earliest": date | None, "applied_rows": [...], "review_rows": [...],
    "error": str | None}``. ``earliest`` is the first smoothed day (cascade start).
    Any RPC or warning-insert failure is printed as ``WARN`` and swallowed so the
    ingestion continues.
    """
    result: Dict[str, Any] = {"earliest": None, "applied_rows": [], "review_rows": [], "error": None}
    try:
        rows = pg.rpc(
            "spotibase_smooth_catchups",
            {
                "p_end_date": run_date.isoformat(),
                "p_lookback_days": CATCHUP_LOOKBACK_DAYS,
                "p_dry_run": False,
            },
        )
    except Exception as err:  # warn-and-continue: smoothing is an enhancement, not a gate
        result["error"] = str(err)
        print(f"WARN Could not run {universe} catch-up smoothing: {err}")
        return result

    if not isinstance(rows, list):
        rows = []
    if not rows:
        print(f"INFO {universe} catch-up smoothing through {run_date}: no catch-up pattern detected")
        return result

    for row in rows:
        if not isinstance(row, dict):
            continue
        print(
            f"INFO {universe} catch-up smoothing {row.get('catchup_date')}: "
            f"status={row.get('status')} tracks_smoothed={row.get('tracks_smoothed')} "
            f"streams_moved={row.get('streams_moved')} tracks_eligible={row.get('tracks_eligible')} "
            f"applied={row.get('applied')}"
        )
        if row.get("applied"):
            result["applied_rows"].append(row)
            first = _parse_date(row.get("first_date"))
            if first is not None and (result["earliest"] is None or first < result["earliest"]):
                result["earliest"] = first
        elif row.get("status") == "mass_guard":
            result["review_rows"].append(row)

    if result["review_rows"]:
        _warn_needs_review(pg, run_date, run_id, universe, result["review_rows"], result)
    return result


def _warn_needs_review(
    pg: Any,
    run_date: date,
    run_id: Any,
    universe: str,
    review_rows: List[Dict[str, Any]],
    result: Dict[str, Any],
) -> None:
    dates = ", ".join(str(r.get("catchup_date")) for r in review_rows)
    detail = "; ".join(
        f"{r.get('catchup_date')}: {r.get('tracks_smoothed')} of {r.get('catalog_tracks')} tracks"
        for r in review_rows
    )
    message = (
        f"Catch-up smoothing was NOT applied for {universe} catalog ({dates}): too many tracks "
        f"would change ({detail}). Review the lag manually."
    )
    print(f"WARN {message}")
    if run_id is None:
        return
    try:
        pg.insert(
            "ingestion_warnings",
            [
                {
                    "run_id": run_id,
                    "run_date": run_date.isoformat(),
                    "playlist_key": None,
                    "severity": "warn",
                    "code": NEEDS_REVIEW_CODE,
                    "message": message,
                    "details_json": {"rows": review_rows},
                }
            ],
        )
    except Exception as err:
        result["error"] = str(err)
        print(f"WARN Could not record {NEEDS_REVIEW_CODE} ingestion warning: {err}")


def smooth_own_catalog(pg: Any, run_date: date, *, run_id: Any = None, reconcile_days: int = 14) -> Dict[str, Any]:
    """Own-catalog pipeline step: reconcile obsolete rows, smooth, then cascade stats.

    The own catalog has no other normalization pass, so the playlist/artist stats
    cascade (``spotibase_recompute_playlist_daily_stats_cascade``, which also
    refreshes artist_daily_stats) is triggered here from the earliest changed day.
    Never raises.
    """
    lookback_start = run_date - timedelta(days=reconcile_days)
    reconciled = 0
    try:
        reconciled = int(
            pg.rpc(
                "spotibase_reconcile_auto_overrides",
                {"p_start_date": lookback_start.isoformat(), "p_end_date": run_date.isoformat()},
            )
            or 0
        )
        if reconciled:
            print(f"INFO Reconciled {reconciled} obsolete auto-catchup override(s)")
    except Exception as err:
        print(f"WARN Could not reconcile auto-catchup overrides: {err}")

    result = run_catchup_smoothing(pg, run_date, run_id=run_id, universe="own")
    start = result["earliest"]
    if reconciled and (start is None or lookback_start < start):
        start = lookback_start
    result["reconciled"] = reconciled
    result["recompute_start"] = start
    if start is not None:
        try:
            recomputed = pg.rpc(
                "spotibase_recompute_playlist_daily_stats_cascade",
                {"p_start_date": start.isoformat(), "p_end_date": run_date.isoformat()},
            )
            print(f"INFO Recomputed playlist_daily_stats for {start}..{run_date}: {recomputed}")
        except Exception as err:
            result["error"] = str(err)
            print(f"WARN Could not recompute playlist stats after catch-up smoothing: {err}")
    return result
