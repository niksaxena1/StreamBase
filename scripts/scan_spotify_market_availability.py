"""Weekly per-market Spotify availability scan for the own catalog.

The daily takedown watch (check_spotify_track_availability.py) only asks "does
this track play anywhere?". This scan asks the finer question: in which Spotify
markets is each own-catalog track NOT playable? Distributors can geo-restrict a
track (e.g. a solo cover blocked in BR, IN, MX, PK) and nothing else surfaces
that.

Method (proven by a one-off prototype):
- Market universe = `available_markets` of a globally released reference track
  (Blinding Lights), minus "XK" (Spotify answers market=XK with HTTP 400 for
  every track). Fewer than 150 markets => abort, write nothing.
- For each market: GET /v1/tracks?ids=<up to 50>&market=M. `is_playable` true
  => available (a `linked_from` means Spotify relinked to another copy, which
  still plays). Otherwise unavailable, reason `restrictions.reason` or "none".
  A null/error entry => unavailable with reason "missing".
- The stored id's own `available_markets` is NOT used: relinked copies report
  zero markets even though they play.

Results go to `public.spotify_track_market_availability`; per-market changes
are logged in `public.spotify_track_market_events` (only for tracks that
already had a previous row, so the first scan seeds silently) and "lost" events
are emailed.

Safety valves (write nothing, exit non-zero; --skip-safety-valve overrides):
- more than 20% of (track, market) checks are "missing" or errored;
- more than 10% of tracks newly lose >= 10 markets in one run.

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

DEFAULT_ALERT_TO = "nikhil.auh@gmail.com"
DEFAULT_SMTP_USERNAME = "nikhil.auh@gmail.com"
DEFAULT_SMTP_FROM = "StreamBase Takedown Watch <nikhil.auh@gmail.com>"

ENTRY_OK = "ok"
ENTRY_ERROR = "error"

EXIT_MISSING_VALVE = 2
EXIT_MASS_LOSS_VALVE = 3
EXIT_BAD_UNIVERSE = 4
EXIT_CANDIDATE_GUARD = 5


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def norm_isrc(isrc: Optional[str]) -> str:
    return "".join(ch for ch in (isrc or "") if ch.isalnum()).upper()


class SpotifyRateLimited(RuntimeError):
    pass


class Spotify:
    """Minimal client-credentials Spotify client with throttling and retries."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        min_interval_s: float = 0.12,
        max_retry_after_s: int = 120,
        session: Optional[requests.Session] = None,
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

    def token(self, force: bool = False) -> str:
        now = time.time()
        if self._token and not force and self._expires_at > now + 30:
            return self._token
        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
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

    def market_entries(self, ids: Sequence[str], market: str) -> List[Tuple[str, Optional[dict]]]:
        """One (ENTRY_OK, body_or_None) or (ENTRY_ERROR, None) per id for this market.

        Batch endpoint first; falls back to single-track calls if the app is
        denied the batch endpoint (403/404), as the takedown watch does.
        """
        if self._batch_supported:
            status, body = self.get(f"/tracks?ids={quote(','.join(ids))}&market={quote(market)}")
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
        out: List[Tuple[str, Optional[dict]]] = []
        for tid in ids:
            status, body = self.get(f"/tracks/{quote(tid, safe='')}?market={quote(market)}")
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


def scan_markets(
    sp: Any,
    tracks: Sequence[dict],
    markets: Sequence[str],
    log=print,
) -> Dict[str, dict]:
    """Per-ISRC scan result: unavailable {market: reason}, checked, errored, relinked."""
    results: Dict[str, dict] = {
        t["isrc"]: {"unavailable": {}, "checked": 0, "errored": [], "relinked": False} for t in tracks
    }
    chunks = [tracks[i : i + BATCH_SIZE] for i in range(0, len(tracks), BATCH_SIZE)]
    for n, market in enumerate(markets, 1):
        for chunk in chunks:
            ids = [c["spotify_track_id"].strip() for c in chunk]
            entries = sp.market_entries(ids, market)
            for track, tid, (state, entry) in zip(chunk, ids, entries):
                res = results[track["isrc"]]
                if state == ENTRY_ERROR:
                    res["errored"].append(market)
                    continue
                res["checked"] += 1
                available, reason, relinked = classify_entry(entry, tid)
                if available:
                    res["relinked"] = res["relinked"] or relinked
                else:
                    res["unavailable"][market] = reason or "none"
        if n % 25 == 0:
            log(f"Scanned {n}/{len(markets)} markets...")
    return results


# ---------------------------------------------------------------------------
# Diffing and rows
# ---------------------------------------------------------------------------

def effective_unavailable(prev: Optional[dict], scan: dict) -> Dict[str, str]:
    """Scan result with errored markets carried over from the previous row."""
    out = dict(scan["unavailable"])
    if prev and scan["errored"]:
        prev_reasons = prev.get("unavailable_reasons") or {}
        for market in scan["errored"]:
            if market in (prev.get("unavailable_markets") or []):
                out[market] = prev_reasons.get(market) or "none"
    return out


def diff_events(prev: Optional[dict], new_unavailable: Dict[str, str], errored: Iterable[str] = ()) -> List[dict]:
    """lost/gained events; none for a track without a previous row (first scan seeds)."""
    if prev is None:
        return []
    skip = set(errored)
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


# ---------------------------------------------------------------------------
# Safety valves
# ---------------------------------------------------------------------------

def missing_share(results: Dict[str, dict]) -> Tuple[int, int]:
    """(missing-or-errored checks, total checks)."""
    bad = total = 0
    for res in results.values():
        errored = len(res["errored"])
        missing = sum(1 for r in res["unavailable"].values() if r == "missing")
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
            events = diff_events(prev, effective_unavailable(prev, res), res["errored"])
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


def build_email(events: List[dict], tracks_by_isrc: Dict[str, dict]) -> Tuple[str, str, str]:
    """Email only 'lost' events, grouped per track."""
    by_isrc: Dict[str, List[str]] = {}
    for e in events:
        if e["event"] == "lost":
            by_isrc.setdefault(e["isrc"], []).append(e["market"])
    n = len(by_isrc)
    subject = f"[StreamBase] Spotify markets: {n} track{'s' if n != 1 else ''} lost availability"
    lines: List[str] = []
    items: List[str] = []
    for isrc, markets in by_isrc.items():
        t = tracks_by_isrc.get(isrc, {})
        name = t.get("name") or isrc
        artists = ", ".join(t.get("artist_names") or []) or "Unknown artist"
        text = f"{artists} – {name} ({isrc}): newly unavailable in {', '.join(sorted(markets))}"
        lines.append(f"- {text}")
        items.append(f"<li>{html.escape(text)}</li>")
    footer = "Checked per country against the Spotify Web API. Full list: StreamBase -> Health -> Spotify markets."
    text_body = "\n".join(lines) + "\n\n" + footer
    html_body = "<ul>" + "".join(items) + f"</ul><p style=\"color:#666;font-size:12px\">{html.escape(footer)}</p>"
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
    markets = sp.market_universe()
    print(f"Market universe: {len(markets)} markets")

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
    print(f"Scanning {len(todo)} of {len(candidates)} catalog tracks across {len(markets)} markets")
    if not todo:
        print("Nothing to scan.")
        return 0

    results = scan_markets(sp, todo, markets)
    now_iso = datetime.now(timezone.utc).isoformat()

    summary = ["## Spotify market scan", f"- Tracks scanned: {len(todo)} · markets: {len(markets)}"]
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
        for ev in diff_events(prev, effective_unavailable(prev, res), res["errored"]):
            new_events.append({"isrc": cand["isrc"], **ev})

    restricted = [r for r in upserts if r["unavailable_markets"]]
    lost = [e for e in new_events if e["event"] == "lost"]
    gained = [e for e in new_events if e["event"] == "gained"]
    seeded = sum(1 for c in todo if c["isrc"] not in prev_by_isrc)
    print(
        f"Done: restricted tracks={len(restricted)}/{len(upserts)} "
        f"lost events={len(lost)} gained events={len(gained)} first-scan tracks={seeded}"
    )
    summary += [
        f"- Tracks with unavailable markets: {len(restricted)} of {len(upserts)}",
        f"- Newly lost: {len(lost)} (track, market) pairs · regained: {len(gained)} · seeded silently: {seeded}",
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
                "notified_at": now_iso if e["event"] == "gained" else None,
            }
            for e in new_events
            if latest.get((e["isrc"], e["market"])) != e["event"]
        ]
        for start in range(0, len(rows), 500):
            pg.insert("spotify_track_market_events", rows[start : start + 500])
    for start in range(0, len(upserts), 500):
        pg.upsert("spotify_track_market_availability", upserts[start : start + 500], on_conflict="isrc")

    # Email every lost event not yet notified (also retries a failed email step).
    pending = pg.select_all(
        "spotify_track_market_events",
        "id,isrc,market,event,reason,detected_at",
        "event=eq.lost&notified_at=is.null",
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
    ap.add_argument("--lookback-days", type=int, default=30, help="Catalog snapshot window defining 'own catalog'")
    ap.add_argument("--min-interval", type=float, default=0.12, help="Seconds between Spotify requests")
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

    sp = Spotify(
        require_env("SPOTIFY_CLIENT_ID"),
        require_env("SPOTIFY_CLIENT_SECRET"),
        min_interval_s=args.min_interval,
    )
    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    return run(pg, sp, args)


if __name__ == "__main__":
    raise SystemExit(main())
