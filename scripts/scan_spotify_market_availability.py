"""Daily per-territory Spotify availability scan for the own catalog.

The daily takedown watch (check_spotify_track_availability.py) only asks "does
this track play anywhere?". This scan asks the finer question: in which Spotify
markets is each own-catalog track NOT playable? Distributors can geo-restrict a
track (e.g. a solo cover blocked in BR, IN, MX, PK) and nothing else surfaces
that.

Spotify enforces a per-app quota, so a per-market sweep (markets x batches,
~11.7k requests) is not viable. The scan uses a few hundred requests:

- Universe (1 request): `available_markets` of a globally released reference
  track (Blinding Lights) minus "XK" (HTTP 400 for every track). Fewer than 150
  markets => abort, write nothing.
- A. List pass: GET /tracks?ids=<50> with NO market => `available_markets` per
  stored track id (~64 requests for 3,200 tracks).
- B. Resolve pass, only for tracks whose list is empty (stale relinked copies
  report 0 markets): GET /tracks?ids=<50>&market=US, then GB, then DE for the
  remainder. A playable entry whose id differs (or has `linked_from`) is the
  current copy; its own `available_markets` (one more list call) is unioned
  with the stored id's list. Still unresolved => market-less ISRC search (other copies; capped by
  --max-search-requests, beyond it "unverified"), then "not_found" everywhere.
- C. Verify pass: for each market M outside a track's union, group tracks by M
  and GET /tracks?ids=<50>&market=M. `is_playable` true => available there
  (another copy); otherwise unavailable with `restrictions.reason` or "none".
  Capped by --max-verify-requests; markets with the most tracks are verified
  first and the rest are recorded from the list with reason "unverified".
- D. Hard budget --max-requests (every API call, retries included): exceeded =>
  abort without writing. Requests used are printed and put in the step summary.

Results go to `public.spotify_track_market_availability`; per-market changes
are logged in `public.spotify_track_market_events` and every unnotified event
('lost' and 'gained') is emailed, one email per run. "unverified" and errored
markets never create events.

First scan of a track ("seeding"): for the bulk catalog the first full scan is
silent (it would otherwise email every long-standing gap). A track whose
`tracks` row was created within the last NEW_TRACK_DAYS (14) days is "new"
instead: it is a release, so if it is missing territories on its first scan the
gaps are recorded as 'lost' events and emailed. If more than MAX_NEW_TRACK_ALERTS
tracks look new at once (bulk re-import), they are seeded silently. A new track
whose answer is uncertain (errored, unverified, not found) is not written at
all, so it is retried by the next run instead of raising a false alarm.

`--new-only` (release-day check, run after the own pipeline enriches new
tracks): scans only catalog tracks that are new (see above), have no row yet and
are not taken down, makes no Spotify call when there are none, and is meant to
run with a small `--max-requests` (the workflow passes 100).

Safety valves (write nothing, exit non-zero; --skip-safety-valve overrides):
- more than 20% of (track, market) checks are missing/not_found or errored;
- more than 10% of tracks newly lose >= 10 markets in one run.
A 429 with Retry-After > 120 s aborts the run with nothing written.

Usage:
  python scripts/scan_spotify_market_availability.py --dry-run --artist Saxena
  python scripts/scan_spotify_market_availability.py --isrc QZ1234567890 --report-csv out.csv
"""

import argparse
import base64
import csv
import html
import json
import os
import smtplib
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote

import requests

if __package__:
    from .streambase_postgrest import Postgrest
    from .streambase_revalidate import notify_web_revalidate
else:
    from streambase_postgrest import Postgrest
    from streambase_revalidate import notify_web_revalidate

REFERENCE_TRACK_ID = "0VjIjW4GlUZAMYd2vXMi3b"  # Blinding Lights, globally released
EXCLUDED_MARKETS = {"XK"}
MIN_UNIVERSE_MARKETS = 150
BATCH_SIZE = 50
PROBE_MARKETS = ("US", "GB", "DE")
DEFAULT_MAX_REQUESTS = 1000
DEFAULT_MAX_VERIFY_REQUESTS = 400
DEFAULT_MAX_SEARCH_REQUESTS = 150
NEW_TRACK_DAYS = 14
MAX_NEW_TRACK_ALERTS = 100

DEFAULT_ALERT_TO = "nikhil.auh@gmail.com"
DEFAULT_SMTP_USERNAME = "nikhil.auh@gmail.com"
DEFAULT_SMTP_FROM = "StreamBase Takedown Watch <nikhil.auh@gmail.com>"

ENTRY_OK = "ok"
ENTRY_ERROR = "error"

EXIT_MISSING_VALVE = 2
EXIT_MASS_LOSS_VALVE = 3
EXIT_BAD_UNIVERSE = 4
EXIT_CANDIDATE_GUARD = 5
EXIT_BUDGET = 6


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def norm_isrc(isrc: Optional[str]) -> str:
    return "".join(ch for ch in (isrc or "") if ch.isalnum()).upper()


class SpotifyRateLimited(RuntimeError):
    pass


class RequestBudgetExceeded(RuntimeError):
    pass


class Spotify:
    """Minimal client-credentials Spotify client with throttling and retries."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        min_interval_s: float = 0.5,
        max_retry_after_s: int = 120,
        session: Optional[requests.Session] = None,
        max_requests: int = DEFAULT_MAX_REQUESTS,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.min_interval_s = max(0.0, min_interval_s)
        self.max_retry_after_s = max_retry_after_s
        self.http = session or requests.Session()
        self._token: Optional[str] = None
        self._expires_at = 0.0
        self._last_request_at = 0.0
        self._batch_supported = True
        self.max_requests = max_requests
        self.requests = 0  # every API call, retries and token calls included

    def _count_request(self) -> None:
        if self.requests >= self.max_requests:
            raise RequestBudgetExceeded(f"Spotify request budget of {self.max_requests} exhausted")
        self.requests += 1

    def token(self, force: bool = False) -> str:
        now = time.time()
        if self._token and not force and self._expires_at > now + 30:
            return self._token
        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
        self._count_request()
        res = self.http.post(
            "https://accounts.spotify.com/api/token",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials"},
            timeout=60,
        )
        if res.status_code != 200:
            raise RuntimeError(f"Spotify token error {res.status_code}: {res.text[:300]}")
        body = res.json()
        self._token = body["access_token"]
        self._expires_at = now + float(body.get("expires_in", 3600))
        return self._token

    def _throttle(self) -> None:
        wait = self._last_request_at + self.min_interval_s - time.time()
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.time()

    def get(self, path: str) -> Tuple[int, Optional[dict]]:
        """Return (status_code, json_or_None). Retries 429/5xx/401/non-JSON 200/connection errors."""
        refreshed = False
        for attempt in range(5):
            self._throttle()
            self._count_request()
            try:
                res = self.http.get(
                    f"https://api.spotify.com/v1{path}",
                    headers={"Authorization": f"Bearer {self.token()}"},
                    timeout=60,
                )
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
                if attempt == 4:
                    raise
                print(f"  [spotify] {type(exc).__name__}; retrying")
                time.sleep(2 ** attempt)
                continue
            if res.status_code == 429:
                retry_after = int(res.headers.get("Retry-After", "5") or 5)
                if retry_after > self.max_retry_after_s:
                    raise SpotifyRateLimited(f"Spotify asked to wait {retry_after}s; aborting run")
                if attempt == 4:
                    raise SpotifyRateLimited("Spotify is still rate-limiting after five attempts; aborting run")
                print(f"  [spotify] rate-limited, waiting {retry_after}s")
                time.sleep(retry_after)
                continue
            if res.status_code == 401 and not refreshed:
                self.token(force=True)
                refreshed = True
                continue
            if res.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            try:
                body = res.json() if res.content else None
            except ValueError:
                if res.status_code == 200:
                    time.sleep(2 ** attempt)  # empty/non-JSON 200 is transient
                    continue
                body = None
            return res.status_code, body
        return 599, None

    def market_universe(self) -> List[str]:
        status, body = self.get(f"/tracks/{REFERENCE_TRACK_ID}")
        markets = body.get("available_markets") if status == 200 and isinstance(body, dict) else None
        return build_universe(markets)

    def search_isrc(self, isrc: str) -> Tuple[int, Optional[dict]]:
        """Market-less ISRC search (items carry available_markets and external_ids)."""
        return self.get(f"/search?q={quote('isrc:' + isrc)}&type=track&limit=10")

    def tracks(self, ids: Sequence[str], market: Optional[str] = None) -> List[Tuple[str, Optional[dict]]]:
        """One (ENTRY_OK, body_or_None) or (ENTRY_ERROR, None) per id (max 50).

        Batch endpoint first; falls back to single-track calls if the app is
        denied the batch endpoint (403/404), as the takedown watch does. The
        fallback costs one request per id, so the request budget aborts it.
        """
        suffix = f"&market={quote(market)}" if market else ""
        if self._batch_supported:
            status, body = self.get(f"/tracks?ids={quote(','.join(ids))}{suffix}")
            if status in (403, 404):
                print("  [spotify] batch endpoint unavailable; using single tracks")
                self._batch_supported = False
            else:
                items = body.get("tracks") if isinstance(body, dict) else None
                if status == 200 and isinstance(items, list) and len(items) == len(ids):
                    return [
                        (ENTRY_OK, item) if isinstance(item, dict) or item is None else (ENTRY_ERROR, None)
                        for item in items
                    ]
                return [(ENTRY_ERROR, None)] * len(ids)
        single = f"?market={quote(market)}" if market else ""
        out: List[Tuple[str, Optional[dict]]] = []
        for tid in ids:
            status, body = self.get(f"/tracks/{quote(tid, safe='')}{single}")
            if status == 200 and isinstance(body, dict):
                out.append((ENTRY_OK, body))
            elif status == 404:
                out.append((ENTRY_OK, None))
            else:
                out.append((ENTRY_ERROR, None))
        return out


def build_universe(markets: Any) -> List[str]:
    """Reference-track markets minus excluded ones; abort when implausibly small."""
    if not isinstance(markets, list):
        raise SystemExit("Could not read the reference track's available_markets; nothing written.")
    universe = sorted({str(m).upper() for m in markets if str(m).strip()} - EXCLUDED_MARKETS)
    if len(universe) < MIN_UNIVERSE_MARKETS:
        raise SystemExit(
            f"Market universe has only {len(universe)} markets (< {MIN_UNIVERSE_MARKETS}); "
            "Spotify API change or outage. Nothing written."
        )
    return universe


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------

def classify_entry(entry: Optional[dict], requested_id: str) -> Tuple[bool, Optional[str], bool]:
    """Return (available, reason, relinked) for one /tracks entry in one market.

    Unavailable reasons: restrictions.reason, "none", or "missing" (null/error body).
    """
    if not isinstance(entry, dict) or entry.get("error") or not entry.get("id"):
        return False, "missing", False
    if entry.get("is_playable") is True:
        relinked = bool(entry.get("linked_from")) or entry.get("id") != requested_id
        return True, None, relinked
    reason = ((entry.get("restrictions") or {}).get("reason") or "").strip().lower() or "none"
    return False, reason, False


def _fetch(
    sp: Any, ids: Sequence[str], market: Optional[str], max_requests: int
) -> Dict[str, Tuple[str, Optional[dict]]]:
    """id -> (state, entry) for unique ids, in batches of 50, enforcing the budget."""
    unique = list(dict.fromkeys(ids))
    out: Dict[str, Tuple[str, Optional[dict]]] = {}
    for i in range(0, len(unique), BATCH_SIZE):
        chunk = unique[i : i + BATCH_SIZE]
        entries = sp.tracks(chunk, market)
        if getattr(sp, "requests", 0) > max_requests:
            raise RequestBudgetExceeded(f"Spotify request budget of {max_requests} exceeded")
        out.update(zip(chunk, entries))
    return out


def _list_markets(entry: Optional[dict], universe: set) -> set:
    markets = entry.get("available_markets") if isinstance(entry, dict) else None
    if not isinstance(markets, list):
        return set()
    return {str(m).upper() for m in markets} & universe


def search_markets(body: dict, isrc: str, universe: set) -> set:
    """Union of available_markets of every search item whose external_ids.isrc matches."""
    tracks = body.get("tracks")
    items = tracks.get("items") if isinstance(tracks, dict) else None
    found: set = set()
    for item in items or []:
        if not isinstance(item, dict):
            continue
        item_isrc = norm_isrc((item.get("external_ids") or {}).get("isrc"))
        if item_isrc and item_isrc == isrc:
            found |= _list_markets(item, universe)
    return found


def verify_plan(groups: Dict[str, List[str]], max_verify_requests: int) -> Tuple[List[str], List[str]]:
    """(markets to verify, markets to leave unverified): most tracks first, within the request cap."""
    ordered = sorted(groups, key=lambda m: (-len(groups[m]), m))
    verify: List[str] = []
    used = 0
    for market in ordered:
        cost = -(-len(groups[market]) // BATCH_SIZE)
        if used + cost > max_verify_requests:
            continue
        verify.append(market)
        used += cost
    skipped = [m for m in ordered if m not in verify]
    return verify, skipped


def scan_catalog(
    sp: Any,
    tracks: Sequence[dict],
    universe: Sequence[str],
    max_verify_requests: int = DEFAULT_MAX_VERIFY_REQUESTS,
    max_requests: int = DEFAULT_MAX_REQUESTS,
    max_search_requests: int = DEFAULT_MAX_SEARCH_REQUESTS,
    log=print,
) -> Dict[str, dict]:
    """Per-ISRC scan result: unavailable {market: reason}, checked, errored, unverified, relinked."""
    uni = set(universe)
    stored = {t["isrc"]: t["spotify_track_id"].strip() for t in tracks}
    results: Dict[str, dict] = {
        isrc: {"unavailable": {}, "checked": len(universe), "errored": [], "unverified": [], "relinked": False}
        for isrc in stored
    }
    union: Dict[str, set] = {}
    needs_resolve: List[str] = []

    # A. list pass (no market): available_markets per stored id
    listed = _fetch(sp, list(stored.values()), None, max_requests)
    log(f"List pass done ({getattr(sp, 'requests', '?')} requests)")
    for isrc, tid in stored.items():
        state, entry = listed[tid]
        if state == ENTRY_ERROR:
            results[isrc]["errored"] = list(universe)
            results[isrc]["checked"] = 0
            continue
        union[isrc] = _list_markets(entry, uni)
        if not union[isrc]:
            needs_resolve.append(isrc)

    # B. resolve pass for stale relinked copies
    resolved_id: Dict[str, str] = {}
    probe_hit: Dict[str, str] = {}
    remaining = list(needs_resolve)
    for market in PROBE_MARKETS:
        if not remaining:
            break
        probed = _fetch(sp, [stored[i] for i in remaining], market, max_requests)
        still: List[str] = []
        for isrc in remaining:
            state, entry = probed[stored[isrc]]
            available, _reason, relinked = classify_entry(entry if state == ENTRY_OK else None, stored[isrc])
            if state == ENTRY_OK and available:
                probe_hit[isrc] = market
                new_id = entry.get("id")
                if relinked and new_id and new_id != stored[isrc]:
                    resolved_id[isrc] = new_id
                    results[isrc]["relinked"] = True
            else:
                still.append(isrc)
        remaining = still
    if resolved_id:
        copies = _fetch(sp, list(resolved_id.values()), None, max_requests)
        for isrc, new_id in resolved_id.items():
            state, entry = copies[new_id]
            if state == ENTRY_OK:
                union[isrc] |= _list_markets(entry, uni)
    for isrc, market in probe_hit.items():
        union[isrc].add(market)  # known playable there
    # Last resort before "not_found": market-less ISRC search (other copies of the recording).
    not_found: set = set()
    searches = 0
    for isrc in remaining:
        if searches >= max_search_requests:
            results[isrc]["unavailable"] = {mk: "unverified" for mk in universe}
            results[isrc]["unverified"] = list(universe)
            union.pop(isrc, None)  # excluded from the verify pass
            continue
        searches += 1
        status, body = sp.search_isrc(norm_isrc(isrc))
        if getattr(sp, "requests", 0) > max_requests:
            raise RequestBudgetExceeded(f"Spotify request budget of {max_requests} exceeded")
        if status != 200 or not isinstance(body, dict):
            results[isrc]["unavailable"] = {mk: "unverified" for mk in universe}
            results[isrc]["unverified"] = list(universe)
            union.pop(isrc, None)
            continue
        found = search_markets(body, norm_isrc(isrc), uni)
        if found:
            union[isrc] = found
            results[isrc]["relinked"] = True
        else:
            not_found.add(isrc)
            results[isrc]["unavailable"] = {mk: "not_found" for mk in universe}
    log(
        f"Resolve pass done ({getattr(sp, 'requests', '?')} requests): {len(needs_resolve)} stale, "
        f"{searches} ISRC searches, {len(not_found)} not found"
    )

    # C. verify pass: group by market outside the union
    groups: Dict[str, List[str]] = {}
    for isrc, markets in union.items():
        if isrc in not_found:
            continue
        for market in uni - markets:
            groups.setdefault(market, []).append(isrc)
    verify, skipped = verify_plan(groups, max_verify_requests)
    for market in skipped:
        for isrc in groups[market]:
            results[isrc]["unverified"].append(market)
            results[isrc]["unavailable"][market] = "unverified"
    for n, market in enumerate(verify, 1):
        isrcs = groups[market]
        got = _fetch(sp, [stored[i] for i in isrcs], market, max_requests)
        for isrc in isrcs:
            state, entry = got[stored[isrc]]
            if state == ENTRY_ERROR:
                results[isrc]["errored"].append(market)
                results[isrc]["checked"] -= 1
                continue
            available, reason, relinked = classify_entry(entry, stored[isrc])
            if available:
                results[isrc]["relinked"] = results[isrc]["relinked"] or relinked
            else:
                results[isrc]["unavailable"][market] = reason or "none"
        if n % 25 == 0:
            log(f"Verified {n}/{len(verify)} markets...")
    log(f"Verify pass done ({getattr(sp, 'requests', '?')} requests): {len(verify)} markets, {len(skipped)} left unverified")
    return results


# ---------------------------------------------------------------------------
# Diffing and rows
# ---------------------------------------------------------------------------

def carried_markets(scan: dict) -> List[str]:
    """Markets without a trustworthy fresh answer (errored or unverified)."""
    return list(scan["errored"]) + list(scan.get("unverified", []))


def effective_unavailable(prev: Optional[dict], scan: dict) -> Dict[str, str]:
    """Scan result where errored/unverified markets keep their previous state when a row exists."""
    out = dict(scan["unavailable"])
    if prev:
        prev_markets = prev.get("unavailable_markets") or []
        prev_reasons = prev.get("unavailable_reasons") or {}
        for market in carried_markets(scan):
            if market in prev_markets:
                out[market] = prev_reasons.get(market) or "none"
            else:
                out.pop(market, None)
    else:
        # First scan: no trustworthy answer means no claim (never seed false gaps).
        for market in carried_markets(scan):
            out.pop(market, None)
    return out


def diff_events(
    prev: Optional[dict],
    new_unavailable: Dict[str, str],
    errored: Iterable[str] = (),
    is_new: bool = False,
) -> List[dict]:
    """lost/gained events.

    A track without a previous row seeds silently, unless it is a new release
    (`is_new`): then every market it is missing on its first scan is a 'lost' event.
    """
    skip = set(errored)
    if prev is None:
        if not is_new:
            return []
        return [
            {"market": market, "event": "lost", "reason": new_unavailable[market]}
            for market in sorted(set(new_unavailable) - skip)
        ]
    before = set(prev.get("unavailable_markets") or [])
    after = set(new_unavailable)
    events = []
    for market in sorted(after - before - skip):
        events.append({"market": market, "event": "lost", "reason": new_unavailable[market]})
    for market in sorted(before - after - skip):
        events.append({"market": market, "event": "gained", "reason": None})
    return events


def build_row(
    candidate: dict,
    scan: dict,
    prev: Optional[dict],
    universe_size: int,
    now_iso: str,
) -> dict:
    unavailable = effective_unavailable(prev, scan)
    markets = sorted(unavailable)
    prev_markets = sorted((prev or {}).get("unavailable_markets") or [])
    changed = prev is None or prev_markets != markets
    return {
        "isrc": candidate["isrc"],
        "spotify_track_id": candidate["spotify_track_id"].strip(),
        "markets_checked": universe_size,
        "available_count": universe_size - len(markets),
        "unavailable_markets": markets,
        "unavailable_reasons": {m: unavailable[m] for m in markets},
        "relinked": bool(scan["relinked"]),
        "first_checked_at": (prev or {}).get("first_checked_at") or now_iso,
        "last_checked_at": now_iso,
        "markets_changed_at": now_iso if changed else (prev or {}).get("markets_changed_at") or now_iso,
    }


def new_track_isrcs(todo: Sequence[dict], prev_by_isrc: Dict[str, dict], recent_isrcs: Iterable[str]) -> set:
    """ISRCs in `todo` that are releases: no stored row yet and a `tracks` row created recently.

    More than MAX_NEW_TRACK_ALERTS of them at once means a bulk (re-)import, not
    releases, so none is treated as new (they seed silently).
    """
    recent = {norm_isrc(i) for i in recent_isrcs}
    new = {c["isrc"] for c in todo if c["isrc"] not in prev_by_isrc and norm_isrc(c["isrc"]) in recent}
    return new if len(new) <= MAX_NEW_TRACK_ALERTS else set()


def is_uncertain(res: dict) -> bool:
    """True when a scan result cannot be trusted for a first row (errored, unverified or not found)."""
    return bool(
        res["errored"]
        or res.get("unverified")
        or any(r in ("missing", "not_found") for r in res["unavailable"].values())
    )


# ---------------------------------------------------------------------------
# Safety valves
# ---------------------------------------------------------------------------

def missing_share(results: Dict[str, dict]) -> Tuple[int, int]:
    """(missing-or-errored checks, total checks)."""
    bad = total = 0
    for res in results.values():
        errored = len(res["errored"])
        missing = sum(1 for r in res["unavailable"].values() if r in ("missing", "not_found"))
        bad += errored + missing
        total += res["checked"] + errored
    return bad, total


def safety_valve_reason(
    results: Dict[str, dict],
    prev_by_isrc: Dict[str, dict],
    max_missing_share: float = 0.20,
    max_mass_loss_share: float = 0.10,
    mass_loss_markets: int = 10,
) -> Optional[Tuple[int, str]]:
    """Return (exit_code, message) when the run should write nothing."""
    bad, total = missing_share(results)
    if total and bad / total > max_missing_share:
        return (
            EXIT_MISSING_VALVE,
            f"{bad} of {total} (track, market) checks were missing or errored (> {max_missing_share:.0%}); "
            "likely a Spotify API change, quota mode or outage. Nothing written.",
        )
    if results:
        mass = 0
        for isrc, res in results.items():
            prev = prev_by_isrc.get(isrc)
            if prev is None:
                continue
            events = diff_events(prev, effective_unavailable(prev, res), carried_markets(res))
            if sum(1 for e in events if e["event"] == "lost") >= mass_loss_markets:
                mass += 1
        if mass / len(results) > max_mass_loss_share:
            return (
                EXIT_MASS_LOSS_VALVE,
                f"{mass} of {len(results)} tracks newly lost >= {mass_loss_markets} markets (> {max_mass_loss_share:.0%}); "
                "likely a Spotify API change. Nothing written. Re-run with --skip-safety-valve if this is real.",
            )
    return None


# ---------------------------------------------------------------------------
# Filtering, report, email
# ---------------------------------------------------------------------------

def filter_candidates(
    candidates: Sequence[dict],
    artist: Optional[str] = None,
    isrcs: Sequence[str] = (),
    limit: int = 0,
) -> List[dict]:
    out = [c for c in candidates if (c.get("spotify_track_id") or "").strip()]
    if artist:
        needle = artist.strip().casefold()
        out = [c for c in out if any((a or "").strip().casefold() == needle for a in (c.get("artist_names") or []))]
    if isrcs:
        wanted = {norm_isrc(i) for i in isrcs}
        out = [c for c in out if norm_isrc(c.get("isrc")) in wanted]
    return out[:limit] if limit else out


def skip_taken_down(candidates: Sequence[dict], taken_down: Iterable[str]) -> Tuple[List[dict], int]:
    """Drop tracks the takedown watch currently marks unavailable; returns (kept, skipped count).

    A taken-down track is unplayable everywhere, so scanning it per territory
    only produces noise. Its stored market row is left untouched (no events, no
    deletes) and it is scanned normally again once the watch sees it back.
    """
    blocked = {norm_isrc(i) for i in taken_down}
    kept = [c for c in candidates if norm_isrc(c.get("isrc")) not in blocked]
    return kept, len(candidates) - len(kept)


def artists_label(candidate: dict) -> str:
    return ", ".join(candidate.get("artist_names") or []) or "Unknown artist"


def write_report_csv(path: str, rows: Sequence[Tuple[dict, dict]]) -> None:
    """rows = (candidate, upsert row); sorted by most markets missing."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(rows, key=lambda r: (-len(r[1]["unavailable_markets"]), r[0].get("name") or ""))
    with open(target, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Artist", "Title", "ISRC", "Available / checked", "Unavailable markets", "Reasons"])
        for cand, row in ordered:
            reasons = "; ".join(f"{m}={r}" for m, r in row["unavailable_reasons"].items())
            w.writerow(
                [
                    artists_label(cand),
                    cand.get("name") or "",
                    cand["isrc"],
                    f"{row['available_count']} / {row['markets_checked']}",
                    ",".join(row["unavailable_markets"]),
                    reasons,
                ]
            )


def _event_line(isrc: str, markets: List[str], verb: str, tracks_by_isrc: Dict[str, dict]) -> str:
    t = tracks_by_isrc.get(isrc, {})
    name = t.get("name") or isrc
    artists = ", ".join(t.get("artist_names") or []) or "Unknown artist"
    return f"{artists} – {name} ({isrc}): {verb} {', '.join(sorted(markets))}"


def build_email(events: List[dict], tracks_by_isrc: Dict[str, dict]) -> Tuple[str, str, str]:
    """One email per run: a 'Lost' and a 'Regained' section, grouped per track."""
    sections = (("lost", "Lost"), ("gained", "Regained"))
    grouped: Dict[str, Dict[str, List[str]]] = {"lost": {}, "gained": {}}
    for e in events:
        if e["event"] in grouped:
            grouped[e["event"]].setdefault(e["isrc"], []).append(e["market"])
    n_lost, n_gained = len(grouped["lost"]), len(grouped["gained"])
    parts = []
    if n_lost:
        parts.append(f"{n_lost} track{'s' if n_lost != 1 else ''} lost")
    if n_gained:
        parts.append(f"{n_gained} regained")
    subject = f"[StreamBase] Territories: {', '.join(parts) or 'no changes'} availability"
    text_blocks: List[str] = []
    html_blocks: List[str] = []
    for key, title in sections:
        if not grouped[key]:
            continue
        verb = "lost" if key == "lost" else "regained"
        lines = [_event_line(i, mk, verb, tracks_by_isrc) for i, mk in grouped[key].items()]
        text_blocks.append(f"{title}\n" + "\n".join(f"- {line}" for line in lines))
        html_blocks.append(f"<h3>{title}</h3><ul>" + "".join(f"<li>{html.escape(line)}</li>" for line in lines) + "</ul>")
    footer = "Checked per territory against the Spotify Web API. Full list: StreamBase -> Health -> Territories."
    text_body = "\n\n".join(text_blocks) + "\n\n" + footer
    html_body = "".join(html_blocks) + f"<p style=\"color:#666;font-size:12px\">{html.escape(footer)}</p>"
    return subject, text_body, html_body


def send_email(recipient: str, subject: str, text_body: str, html_body: str) -> None:
    username = (os.environ.get("NOTIFY_SMTP_USERNAME") or DEFAULT_SMTP_USERNAME).strip()
    password = require_env("NOTIFY_SMTP_PASSWORD")
    sender = (os.environ.get("TAKEDOWN_ALERT_FROM") or DEFAULT_SMTP_FROM).strip()
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(f"<html><body>{html_body}</body></html>", subtype="html")
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=60) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)


def write_step_summary(markdown: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(markdown + "\n")


def prepare_workflow_email(path: str, pending: List[dict], subject: str, text_body: str, html_body: str) -> None:
    payload = {"ids": [e["id"] for e in pending], "subject": subject, "body": text_body, "html_body": html_body}
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as f:
            f.write(f"alert={json.dumps(payload, ensure_ascii=True)}\n")


def acknowledge_workflow_email(pg: Postgrest, path: str) -> None:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    ids = payload["ids"]
    if not isinstance(ids, list) or not ids or any(type(i) is not int or i <= 0 for i in ids):
        raise ValueError("Notification acknowledgement requires positive event IDs")
    now_iso = datetime.now(timezone.utc).isoformat()
    for start in range(0, len(ids), 500):
        id_filter = ",".join(str(i) for i in ids[start : start + 500])
        pg.patch("spotify_track_market_events", {"notified_at": now_iso}, f"id=in.({id_filter})")


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def run(pg: Postgrest, sp: Any, args: argparse.Namespace) -> int:
    new_only = bool(getattr(args, "new_only", False))
    candidates = pg.rpc_all("spotify_availability_candidates", {"p_lookback_days": args.lookback_days}, order="isrc.asc")
    prev_rows = pg.select_all(
        "spotify_track_market_availability",
        "isrc,unavailable_markets,unavailable_reasons,first_checked_at,markets_changed_at",
        "isrc=not.is.null",
        order="isrc.asc",
    )
    if len(candidates) < len(prev_rows) * 0.5:
        msg = (
            f"Refusing to scan {len(candidates)} candidates against {len(prev_rows)} previously scanned tracks (< 50%); "
            "possible candidate truncation. Nothing written."
        )
        print(msg)
        write_step_summary(f"## Spotify market scan\n- **{msg}**")
        return EXIT_CANDIDATE_GUARD
    prev_by_isrc = {r["isrc"]: r for r in prev_rows}
    tracks_by_isrc = {c["isrc"]: c for c in candidates}

    todo = filter_candidates(candidates, args.artist, args.isrc or [], args.limit)
    taken_down = pg.select_all(
        "spotify_track_availability", "isrc", "status=eq.unavailable", order="isrc.asc"
    )
    todo, skipped_down = skip_taken_down(todo, [r["isrc"] for r in taken_down])
    if skipped_down:
        print(f"Skipping {skipped_down} track(s) the takedown watch marks unavailable (existing rows untouched)")

    # Releases: no stored row yet and a `tracks` row created in the last NEW_TRACK_DAYS days.
    new_isrcs: set = set()
    if any(c["isrc"] not in prev_by_isrc for c in todo):
        since_new = (datetime.now(timezone.utc) - timedelta(days=NEW_TRACK_DAYS)).isoformat()
        recent_tracks = pg.select_all("tracks", "isrc", f"created_at=gte.{quote(since_new)}", order="isrc.asc")
        new_isrcs = new_track_isrcs(todo, prev_by_isrc, [r["isrc"] for r in recent_tracks])
    if new_only:
        todo = [c for c in todo if c["isrc"] in new_isrcs]
        print(f"New-only: {len(todo)} new catalog track(s) without a territory row")
    print(f"Scanning {len(todo)} of {len(candidates)} catalog tracks")
    if not todo:
        print("Nothing to scan.")
        return 0

    markets = sp.market_universe()
    print(f"Market universe: {len(markets)} markets")

    try:
        results = scan_catalog(
            sp,
            todo,
            markets,
            max_verify_requests=args.max_verify_requests,
            max_requests=args.max_requests,
            max_search_requests=args.max_search_requests,
        )
    except RequestBudgetExceeded as exc:
        msg = f"{exc} after {getattr(sp, 'requests', '?')} requests. Nothing written."
        print(msg)
        write_step_summary("## Spotify market scan\n- **" + msg + "**")
        return EXIT_BUDGET
    now_iso = datetime.now(timezone.utc).isoformat()
    requests_used = getattr(sp, "requests", 0)
    print(f"Spotify requests used: {requests_used} (budget {args.max_requests})")

    # A new release with an uncertain answer is retried by the next run, not written (no false alarm).
    deferred = [c for c in todo if c["isrc"] in new_isrcs and is_uncertain(results[c["isrc"]])]
    if deferred:
        print(f"Deferring {len(deferred)} new track(s) with an uncertain answer to the next run")
        deferred_isrcs = {c["isrc"] for c in deferred}
        todo = [c for c in todo if c["isrc"] not in deferred_isrcs]
        results = {i: r for i, r in results.items() if i not in deferred_isrcs}
    if not todo:
        write_step_summary(f"## Spotify market scan\n- {len(deferred)} new track(s) deferred (uncertain answer); nothing written.")
        return 0

    summary = [
        "## Spotify market scan" + (" (new tracks only)" if new_only else ""),
        f"- Tracks scanned: {len(todo)} · territories: {len(markets)} · skipped (taken down): {skipped_down} · deferred: {len(deferred)}",
        f"- Spotify requests used: {requests_used} (budget {args.max_requests}, verify cap {args.max_verify_requests}, search cap {args.max_search_requests})",
    ]
    if not args.skip_safety_valve:
        valve = safety_valve_reason(results, prev_by_isrc)
        if valve:
            print(valve[1])
            write_step_summary("\n".join(summary + [f"- **{valve[1]}**"]))
            return valve[0]

    upserts: List[dict] = []
    report_rows: List[Tuple[dict, dict]] = []
    new_events: List[dict] = []
    for cand in todo:
        prev = prev_by_isrc.get(cand["isrc"])
        res = results[cand["isrc"]]
        row = build_row(cand, res, prev, len(markets), now_iso)
        upserts.append(row)
        report_rows.append((cand, row))
        for ev in diff_events(prev, effective_unavailable(prev, res), carried_markets(res), cand["isrc"] in new_isrcs):
            new_events.append({"isrc": cand["isrc"], **ev})

    restricted = [r for r in upserts if r["unavailable_markets"]]
    lost = [e for e in new_events if e["event"] == "lost"]
    gained = [e for e in new_events if e["event"] == "gained"]
    seeded = sum(1 for c in todo if c["isrc"] not in prev_by_isrc and c["isrc"] not in new_isrcs)
    print(
        f"Done: restricted tracks={len(restricted)}/{len(upserts)} "
        f"lost events={len(lost)} gained events={len(gained)} first-scan tracks={seeded}"
    )
    summary += [
        f"- Tracks with unavailable markets: {len(restricted)} of {len(upserts)}",
        f"- Newly lost: {len(lost)} (track, market) pairs · regained: {len(gained)} · seeded silently: {seeded} · new releases: {sum(1 for c in todo if c['isrc'] in new_isrcs)}",
    ]

    if args.report_csv:
        write_report_csv(args.report_csv, report_rows)
        print(f"Report written to {args.report_csv}")

    if args.dry_run:
        print("Dry run: no writes, no email.")
        for cand, row in sorted(report_rows, key=lambda r: -len(r[1]["unavailable_markets"]))[:20]:
            if row["unavailable_markets"]:
                print(
                    f"  {artists_label(cand)} – {cand.get('name')} ({cand['isrc']}): "
                    f"{row['available_count']}/{row['markets_checked']}; "
                    f"unavailable in {','.join(row['unavailable_markets'])}"
                )
        write_step_summary("\n".join(summary + ["- Dry run: nothing written."]))
        return 0

    # Events first so a crash can't record a change without its alert. Skip an
    # event when the latest one for that (isrc, market) already says the same.
    if new_events:
        since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        recent = pg.select_all(
            "spotify_track_market_events",
            "isrc,market,event,detected_at",
            f"detected_at=gte.{quote(since)}",
            order="detected_at.asc",
        )
        latest = {(r["isrc"], r["market"]): r["event"] for r in recent}
        rows = [
            # PostgREST bulk inserts need identical keys on every row.
            {
                "isrc": e["isrc"],
                "market": e["market"],
                "event": e["event"],
                "reason": e["reason"],
                "notified_at": None,
            }
            for e in new_events
            if latest.get((e["isrc"], e["market"])) != e["event"]
        ]
        for start in range(0, len(rows), 500):
            pg.insert("spotify_track_market_events", rows[start : start + 500])
    for start in range(0, len(upserts), 500):
        pg.upsert("spotify_track_market_availability", upserts[start : start + 500], on_conflict="isrc")

    # Email every event (lost and regained) not yet notified, one email per run (also retries a failed email step).
    pending = pg.select_all(
        "spotify_track_market_events",
        "id,isrc,market,event,reason,detected_at",
        "notified_at=is.null",
        order="id.asc",
    )
    if pending:
        missing_meta = [e["isrc"] for e in pending if e["isrc"] not in tracks_by_isrc]
        if missing_meta:
            for row in pg.select_all(
                "tracks", "isrc,name,spotify_artist_names", f"isrc=in.({','.join(quote(i) for i in missing_meta)})"
            ):
                tracks_by_isrc[row["isrc"]] = {"name": row.get("name"), "artist_names": row.get("spotify_artist_names")}
        subject, text_body, html_body = build_email(pending, tracks_by_isrc)
        if args.email_output:
            prepare_workflow_email(args.email_output, pending, subject, text_body, html_body)
            summary.append(f"- Email prepared for workflow: {subject}")
        else:
            recipient = (os.environ.get("TAKEDOWN_ALERT_TO") or DEFAULT_ALERT_TO).strip()
            send_email(recipient, subject, text_body, html_body)
            for start in range(0, len(pending), 500):
                ids = ",".join(str(e["id"]) for e in pending[start : start + 500])
                pg.patch("spotify_track_market_events", {"notified_at": now_iso}, f"id=in.({ids})")
            print(f"Emailed {len(pending)} event(s) to {recipient}: {subject}")
            summary.append(f"- Emailed: {subject}")

    if upserts:
        notify_web_revalidate()  # refresh Health / Home / Catalog now, not in an hour

    write_step_summary("\n".join(summary))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="Scan and report without writing or emailing")
    ap.add_argument("--limit", type=int, default=0, help="Max tracks to scan (0 = all)")
    ap.add_argument("--artist", help="Only tracks with this artist name (case-insensitive)")
    ap.add_argument("--isrc", action="append", help="Only this ISRC (repeatable)")
    ap.add_argument("--new-only", action="store_true", help="Release-day check: scan only new catalog tracks (created in the last 14 days) that have no territory row yet")
    ap.add_argument("--lookback-days", type=int, default=30, help="Catalog snapshot window defining 'own catalog'")
    ap.add_argument("--min-interval", type=float, default=0.5, help="Seconds between Spotify requests")
    ap.add_argument("--max-requests", type=int, default=DEFAULT_MAX_REQUESTS, help="Hard budget of Spotify API calls (abort, no writes, if exceeded)")
    ap.add_argument("--max-search-requests", type=int, default=DEFAULT_MAX_SEARCH_REQUESTS, help="Cap on ISRC searches for unresolved tracks; beyond it they are recorded as unverified")
    ap.add_argument("--max-verify-requests", type=int, default=DEFAULT_MAX_VERIFY_REQUESTS, help="Cap on per-market verify requests; the rest are recorded as unverified")
    ap.add_argument("--report-csv", help="Write a CSV report to this path")
    ap.add_argument("--email-output", help="Prepare email JSON for the workflow composite action instead of SMTP")
    ap.add_argument("--ack-notifications", help="Mark event IDs in this JSON as notified; no Spotify calls")
    ap.add_argument("--skip-safety-valve", action="store_true", help="Write even if the safety valves trip")
    args = ap.parse_args()

    if args.ack_notifications:
        if args.dry_run or args.email_output:
            ap.error("--ack-notifications cannot be combined with scan options")
        pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
        acknowledge_workflow_email(pg, args.ack_notifications)
        return 0

    if args.limit < 0 or args.lookback_days < 1 or args.min_interval < 0:
        ap.error("limit and min-interval must be nonnegative; lookback-days must be positive")
    if args.max_requests < 1 or args.max_verify_requests < 0 or args.max_search_requests < 0:
        ap.error("max-requests must be positive; max-verify-requests nonnegative")

    sp = Spotify(
        require_env("SPOTIFY_CLIENT_ID"),
        require_env("SPOTIFY_CLIENT_SECRET"),
        min_interval_s=args.min_interval,
        max_requests=args.max_requests,
    )
    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    return run(pg, sp, args)


if __name__ == "__main__":
    raise SystemExit(main())
