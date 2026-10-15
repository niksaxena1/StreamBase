"""Best-of-all-sources consolidation rules for repairing a stale cumulative stream count.

Pure functions only (no network, no database) so the rules are unit-tested in
``scripts/tests/test_stream_consolidation.py`` and shared by ``rapidapi_stale_fix.py``.

For one (isrc, run_date) several sources can offer a cumulative count: free lookup
providers (Beat Analytics, Music Metrics, MusicAnalytics, CheckLeakedCC) and the artist.tools
observation. A candidate is *plausible* when ALL hold:

* it is above the value currently stored for the run date (otherwise it fixes nothing),
* it is at least the previous day's effective value (a cumulative count never goes down),
* the gain over the previous day is at most ``PLAUSIBLE_JUMP_MULTIPLIER`` times the track's
  typical daily gain (mean of the positive day-over-day gains in the trailing 7 days, never
  less than ``MIN_DAILY_GAIN_ALLOWANCE``), multiplied by ``1 + flat_run`` when the track was
  already flat for ``flat_run`` days before the run date (a multi-day stale catches up in one go).

Among plausible candidates the highest value wins; ties go to the earlier-listed source.
Rejected candidates are returned with a reason so the caller can log them. When the previous
day's value is unknown the cap cannot be evaluated, so only the "above current" floor applies
(same as the pre-consolidation behaviour).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

PLAUSIBLE_JUMP_MULTIPLIER = 5
MIN_DAILY_GAIN_ALLOWANCE = 1000
TRAILING_DAYS = 7
MAX_FLAT_RUN = 6

REASON_INVALID = "invalid_value"
REASON_NOT_ABOVE_CURRENT = "not_above_current"
REASON_BELOW_PREVIOUS = "below_previous_day"
REASON_JUMP_OVER_CAP = "jump_over_cap"


@dataclass(frozen=True)
class Context:
    """What we know about a track on the run date."""

    stale_value: int
    prev_value: Optional[int] = None
    avg_daily_gain: Optional[float] = None
    flat_run: int = 0


@dataclass(frozen=True)
class Reject:
    source: str
    value: Optional[int]
    reason: str
    prev_value: Optional[int] = None
    cap_value: Optional[int] = None


@dataclass
class Decision:
    value: Optional[int] = None
    source: Optional[str] = None
    plausible: List[Tuple[str, int]] = field(default_factory=list)
    rejects: List[Reject] = field(default_factory=list)

    @property
    def accepted(self) -> bool:
        return self.value is not None


def history_stats(history: Iterable[Tuple[date, int]], as_of: date) -> Tuple[Optional[int], Optional[float], int]:
    """Return ``(prev_value, avg_daily_gain, flat_run)`` from effective values before ``as_of``.

    ``history`` is any iterable of ``(date, cumulative)``; only dates in
    ``[as_of - TRAILING_DAYS - 1, as_of - 1]`` are used. ``prev_value`` is the value on
    ``as_of - 1`` (None when that day is missing).
    """
    window_start = as_of - timedelta(days=TRAILING_DAYS + 1)
    points = sorted(
        {d: int(v) for d, v in history if window_start <= d < as_of and v is not None}.items()
    )
    prev = next((v for d, v in points if d == as_of - timedelta(days=1)), None)
    gains: List[float] = []
    for (d0, v0), (d1, v1) in zip(points, points[1:]):
        gap = (d1 - d0).days
        if gap >= 1 and v1 > v0:
            gains.append((v1 - v0) / gap)
    avg = sum(gains) / len(gains) if gains else None
    flat = 0
    expected = as_of - timedelta(days=1)
    for d, v in reversed(points):
        if d != expected:
            break
        earlier = next((pv for pd, pv in points if pd == d - timedelta(days=1)), None)
        if earlier is None or earlier != v:
            break
        flat += 1
        expected = d - timedelta(days=1)
        if flat >= MAX_FLAT_RUN:
            break
    return prev, avg, flat


def gain_cap(ctx: Context) -> Optional[int]:
    """Largest plausible cumulative value for the run date, or None when prev is unknown."""
    if ctx.prev_value is None:
        return None
    allowance = max(ctx.avg_daily_gain or 0.0, float(MIN_DAILY_GAIN_ALLOWANCE))
    allowed_gain = PLAUSIBLE_JUMP_MULTIPLIER * allowance * (1 + max(0, ctx.flat_run))
    return int(ctx.prev_value + allowed_gain)


def check_candidate(source: str, value: Optional[int], ctx: Context) -> Optional[Reject]:
    """Return a Reject when the candidate is not plausible, else None."""
    if value is None or value < 0:
        return Reject(source, value, REASON_INVALID, ctx.prev_value)
    cap = gain_cap(ctx)
    if value <= ctx.stale_value:
        return Reject(source, value, REASON_NOT_ABOVE_CURRENT, ctx.prev_value, cap)
    if ctx.prev_value is not None and value < ctx.prev_value:
        return Reject(source, value, REASON_BELOW_PREVIOUS, ctx.prev_value, cap)
    if cap is not None and value > cap:
        return Reject(source, value, REASON_JUMP_OVER_CAP, ctx.prev_value, cap)
    return None


def consolidate(candidates: Sequence[Tuple[str, Optional[int]]], ctx: Context) -> Decision:
    """Pick the highest plausible candidate; collect rejects for the rest."""
    decision = Decision()
    for source, value in candidates:
        if value is None:
            continue
        reject = check_candidate(source, value, ctx)
        if reject is not None:
            decision.rejects.append(reject)
            continue
        decision.plausible.append((source, int(value)))
        if decision.value is None or int(value) > decision.value:
            decision.value = int(value)
            decision.source = source
    return decision


def provenance_note(decision: Decision, *, second_look: bool = False) -> str:
    """Override note. Keeps the ``stale-fix: <source> auto`` prefix other code and SQL match on."""
    if not decision.accepted:
        raise ValueError("no accepted value")
    note = f"stale-fix: {decision.source} auto"
    if second_look:
        note += "; second-look"
    others = [(s, v) for s, v in decision.plausible if s != decision.source]
    if others:
        note += "; best-of=" + ",".join(f"{s}:{v}" for s, v in [(decision.source, decision.value), *others])
    return note


def rows_by_isrc(rows: Iterable[dict]) -> Dict[str, List[Tuple[date, int]]]:
    """Group effective-view rows ({isrc, date, streams_cumulative}) into per-ISRC history."""
    out: Dict[str, List[Tuple[date, int]]] = {}
    for row in rows:
        isrc = str(row.get("isrc") or "").strip().upper()
        raw_date = row.get("date")
        value = row.get("streams_cumulative")
        if not isrc or raw_date is None or value is None:
            continue
        d = raw_date if isinstance(raw_date, date) else date.fromisoformat(str(raw_date)[:10])
        out.setdefault(isrc, []).append((d, int(value)))
    return out
