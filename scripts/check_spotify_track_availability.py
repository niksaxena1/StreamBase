"""Daily Spotify takedown watch for the own catalog.

SpotOnTrack exports lag ~2 days, so a takedown (infringement report,
distributor pull, ...) normally surfaces in StreamBase late. This script asks
the Spotify Web API directly for every own-catalog track with a known
`spotify_track_id` and records the verdict in
`public.spotify_track_availability`. Transitions are logged in
`public.spotify_track_availability_events` and emailed:

- available -> unavailable  => "taken_down"
- unavailable -> available  => "restored"

Detection per track (client-credentials token):
1. GET /tracks/{id}?market=M for each configured market, stopping at the
   first market where the track plays. 404 => gone; is_playable=false with
   restriction reason "market" (or none) => unplayable there. A response
   whose id differs from the requested one is Spotify relinking to an
   equivalent copy, which still counts as available.
2. If the track looks unplayable in every market (or the API gives no
   playability signal), confirm with an ISRC search in the first market. A
   playable hit means it was relinked/re-delivered, not taken down.

Safety valves: if an implausibly large share of the catalog flips to
unavailable in one run, or most checks return no usable answer (API change,
quota mode, outage), nothing is written or emailed and the run exits non-zero
so the workflow failure email fires instead.

Usage:
  python scripts/check_spotify_track_availability.py              # full run
  python scripts/check_spotify_track_availability.py --dry-run    # no writes/emails
  python scripts/check_spotify_track_availability.py --track-id 3SkuTkIkeNa9l2UCexClYh
"""

import argparse
import base64
import html
import os
import smtplib
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote

import requests

from streambase_postgrest import Postgrest
from streambase_revalidate import notify_web_revalidate

DEFAULT_MARKETS = ("US", "GB", "AE")
DEFAULT_ALERT_TO = "nikhil.auh@gmail.com"
DEFAULT_SMTP_USERNAME = "nikhil.auh@gmail.com"
DEFAULT_SMTP_FROM = "StreamBase Takedown Watch <nikhil.auh@gmail.com>"

# Restriction reasons that are about the listener (explicit filter, account
# tier), not about the track being pulled from the catalog.
NON_TAKEDOWN_RESTRICTIONS = {"explicit", "product"}

AVAILABLE = "available"
UNAVAILABLE = "unavailable"
UNKNOWN = "unknown"


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def norm_isrc(isrc: Optional[str]) -> str:
    """Spotify's isrc: search wants the canonical 12-char form; SpotOnTrack
    sometimes exports hyphenated ISRCs (e.g. "GB-SMU-30-65473")."""
    return "".join(ch for ch in (isrc or "") if ch.isalnum()).upper()


def spotify_track_url(track_id: str) -> str:
    return f"https://open.spotify.com/track/{track_id}"


class SpotifyRateLimited(RuntimeError):
    pass


class Spotify:
    """Minimal client-credentials Spotify client with throttling and retries."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        min_interval_s: float = 0.15,
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
        """Return (status_code, json_or_None). Retries 429/5xx/401; 4xx are returned as-is."""
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
                body = None
            return res.status_code, body
        return 599, None

    def track(self, track_id: str, market: str) -> Tuple[int, Optional[dict]]:
        return self.get(f"/tracks/{quote(track_id)}?market={quote(market)}")

    def search_isrc(self, isrc: str, market: str) -> Tuple[int, Optional[dict]]:
        q = quote(f"isrc:{isrc}")
        return self.get(f"/search?q={q}&type=track&market={quote(market)}&limit=1")


@dataclass(frozen=True)
class Verdict:
    state: str  # available | unavailable | unknown
    reason: Optional[str] = None
    markets_checked: Tuple[str, ...] = ()


def classify_track_response(status: int, body: Optional[dict], requested_id: str) -> Verdict:
    """Interpret one GET /tracks/{id}?market=M response."""
    if status == 404:
        return Verdict(UNAVAILABLE, "not_found")
    if status != 200 or not isinstance(body, dict):
        return Verdict(UNKNOWN, f"http_{status}")

    returned_id = body.get("id")
    playable = body.get("is_playable")
    if playable is True:
        if returned_id and returned_id != requested_id:
            return Verdict(AVAILABLE, f"relinked:{returned_id}")
        return Verdict(AVAILABLE)
    if playable is False:
        restriction = ((body.get("restrictions") or {}).get("reason") or "").strip().lower()
        if restriction in NON_TAKEDOWN_RESTRICTIONS:
            return Verdict(AVAILABLE, f"restricted:{restriction}")
        return Verdict(UNAVAILABLE, f"not_playable:{restriction}" if restriction else "not_playable")

    # No playability signal (field stripped). An explicit empty market list is
    # still a strong signal; otherwise defer to the ISRC search.
    markets = body.get("available_markets")
    if isinstance(markets, list) and not markets:
        return Verdict(UNAVAILABLE, "no_markets")
    return Verdict(UNKNOWN, "no_playability_signal")


def classify_search_response(status: int, body: Optional[dict]) -> Verdict:
    """Interpret a market-scoped ISRC search used as confirmation."""
    if status != 200 or not isinstance(body, dict):
        return Verdict(UNKNOWN, f"search_http_{status}")
    items = ((body.get("tracks") or {}).get("items")) or []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("is_playable") is False:
            continue
        return Verdict(AVAILABLE, f"search_hit:{item.get('id')}")
    return Verdict(UNAVAILABLE, "isrc_search_miss")


def check_track(sp: Spotify, track_id: str, isrc: str, markets: Sequence[str]) -> Verdict:
    checked: List[str] = []
    unavailable_reasons: List[str] = []
    saw_unknown = False
    for market in markets:
        checked.append(market)
        v = classify_track_response(*sp.track(track_id, market), requested_id=track_id)
        if v.state == AVAILABLE:
            return Verdict(AVAILABLE, v.reason, tuple(checked))
        if v.state == UNAVAILABLE:
            unavailable_reasons.append(v.reason or UNAVAILABLE)
            if v.reason == "not_found":
                break  # 404 is market-independent
        else:
            saw_unknown = True
            if v.reason and v.reason.startswith("http_"):
                # Transient/odd API error: don't guess.
                return Verdict(UNKNOWN, v.reason, tuple(checked))
            break  # no playability signal won't differ by market; go to search

    isrc = norm_isrc(isrc)
    if not isrc:
        if unavailable_reasons and not saw_unknown:
            return Verdict(UNAVAILABLE, unavailable_reasons[0], tuple(checked))
        return Verdict(UNKNOWN, "no_isrc_for_confirmation", tuple(checked))

    confirm = classify_search_response(*sp.search_isrc(isrc, markets[0]))
    if confirm.state == AVAILABLE:
        hit = (confirm.reason or "").split(":", 1)[-1]
        if hit and hit != track_id:
            return Verdict(AVAILABLE, f"relinked:{hit}", tuple(checked))
        if unavailable_reasons:
            # Track endpoint says unplayable but search serves it: trust search.
            return Verdict(AVAILABLE, "search_playable", tuple(checked))
        return Verdict(AVAILABLE, None, tuple(checked))
    if confirm.state == UNAVAILABLE:
        reason = unavailable_reasons[0] if unavailable_reasons else "isrc_search_miss"
        return Verdict(UNAVAILABLE, reason, tuple(checked))
    return Verdict(UNKNOWN, confirm.reason, tuple(checked))


def next_state(
    prev: Optional[dict],
    candidate: dict,
    verdict: Verdict,
    now_iso: str,
) -> Tuple[dict, Optional[str]]:
    """Return (row to upsert, event name or None) for a definitive verdict."""
    assert verdict.state in (AVAILABLE, UNAVAILABLE)
    prev_status = (prev or {}).get("status")
    changed = prev_status != verdict.state
    row = {
        "isrc": candidate["isrc"],
        "spotify_track_id": candidate["spotify_track_id"],
        "status": verdict.state,
        "reason": verdict.reason,
        "markets_checked": list(verdict.markets_checked),
        "first_checked_at": (prev or {}).get("first_checked_at") or now_iso,
        "last_checked_at": now_iso,
        "status_changed_at": now_iso if changed else (prev or {}).get("status_changed_at") or now_iso,
        "last_available_at": now_iso if verdict.state == AVAILABLE else (prev or {}).get("last_available_at"),
        "unavailable_since": (
            None
            if verdict.state == AVAILABLE
            else ((prev or {}).get("unavailable_since") if not changed else None) or now_iso
        ),
    }
    event: Optional[str] = None
    if verdict.state == UNAVAILABLE and prev_status != UNAVAILABLE:
        event = "taken_down"
    elif verdict.state == AVAILABLE and prev_status == UNAVAILABLE:
        event = "restored"
    return row, event


def is_suspicious_mass_takedown(new_takedowns: int, checked: int, min_count: int, max_share: float) -> bool:
    return checked > 0 and new_takedowns >= min_count and new_takedowns / checked > max_share


def _fmt_int(n: Any) -> str:
    try:
        return f"{int(n):,}"
    except (TypeError, ValueError):
        return "—"


def build_email(events: List[dict], tracks_by_isrc: Dict[str, dict]) -> Tuple[str, str, str]:
    """Return (subject, text_body, html_body) for pending events."""
    downs = [e for e in events if e["event"] == "taken_down"]
    ups = [e for e in events if e["event"] == "restored"]
    parts = []
    if downs:
        parts.append(f"{len(downs)} track{'s' if len(downs) != 1 else ''} taken down")
    if ups:
        parts.append(f"{len(ups)} restored")
    subject = f"[StreamBase] Spotify: {', '.join(parts)}"

    def line(e: dict) -> Tuple[str, str]:
        t = tracks_by_isrc.get(e["isrc"], {})
        name = t.get("name") or e["isrc"]
        artists = ", ".join(t.get("artist_names") or []) or "Unknown artist"
        url = spotify_track_url(e["spotify_track_id"])
        detected = str(e.get("detected_at") or "")[:16].replace("T", " ")
        meta = (
            f"ISRC {e['isrc']} · reason {e.get('reason') or '—'} · "
            f"last streams {_fmt_int(t.get('streams_cumulative'))} "
            f"(catalog {t.get('last_catalog_date') or '—'}) · detected {detected} UTC"
        )
        text = f"- {artists} – {name}\n  {url}\n  {meta}"
        markup = (
            f"<li><a href=\"{html.escape(url)}\"><strong>{html.escape(name)}</strong></a> — "
            f"{html.escape(artists)}<br><span style=\"color:#666;font-size:12px\">{html.escape(meta)}</span></li>"
        )
        return text, markup

    text_sections: List[str] = []
    html_sections: List[str] = []
    for title, group in (("Taken down / unplayable on Spotify", downs), ("Available again", ups)):
        if not group:
            continue
        rendered = [line(e) for e in group]
        text_sections.append(f"{title}:\n" + "\n".join(r[0] for r in rendered))
        html_sections.append(f"<h3>{html.escape(title)}</h3><ul>" + "".join(r[1] for r in rendered) + "</ul>")

    footer = (
        "Checked directly against the Spotify Web API (SpotOnTrack data lags ~2 days). "
        "Full list: StreamBase → Health → Spotify availability."
    )
    text_body = "\n\n".join(text_sections + [footer])
    html_body = "".join(html_sections) + f"<p style=\"color:#666;font-size:12px\">{html.escape(footer)}</p>"
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


def parse_markets(raw: Optional[str]) -> Tuple[str, ...]:
    markets = tuple(m.strip().upper() for m in (raw or "").split(",") if m.strip())
    return markets or DEFAULT_MARKETS


def run_single(sp: Spotify, track_id: str, isrc: str, markets: Sequence[str]) -> int:
    for market in markets:
        status, body = sp.track(track_id, market)
        keys = {k: (body or {}).get(k) for k in ("id", "name", "is_playable", "restrictions")}
        print(f"GET /tracks/{track_id}?market={market} -> {status} {keys}")
    if isrc:
        status, body = sp.search_isrc(isrc, markets[0])
        items = ((body or {}).get("tracks") or {}).get("items") or []
        print(f"search isrc:{isrc} market={markets[0]} -> {status}, {len(items)} hit(s)")
    verdict = check_track(sp, track_id, isrc, markets)
    print(f"Verdict: {verdict.state} (reason={verdict.reason}, markets={','.join(verdict.markets_checked)})")
    return 0


def run(pg: Postgrest, sp: Spotify, args: argparse.Namespace, markets: Sequence[str]) -> int:
    candidates = pg.rpc("spotify_availability_candidates", {"p_lookback_days": args.lookback_days}) or []
    checkable = [c for c in candidates if (c.get("spotify_track_id") or "").strip()]
    missing_ids = len(candidates) - len(checkable)
    if args.limit:
        checkable = checkable[: args.limit]
    print(f"Candidates: {len(candidates)} catalog tracks ({missing_ids} without a Spotify id, skipped)")

    prev_rows = pg.select_all(
        "spotify_track_availability",
        "isrc,status,first_checked_at,status_changed_at,last_available_at,unavailable_since",
        "isrc=not.is.null",
        order="isrc.asc",
    )
    prev_by_isrc = {r["isrc"]: r for r in prev_rows}
    tracks_by_isrc = {c["isrc"]: c for c in candidates}

    now_iso = datetime.now(timezone.utc).isoformat()
    upserts: List[dict] = []
    new_events: List[dict] = []
    counts = {AVAILABLE: 0, UNAVAILABLE: 0, UNKNOWN: 0}
    for i, c in enumerate(checkable, 1):
        track_id = c["spotify_track_id"].strip()
        verdict = check_track(sp, track_id, (c.get("isrc") or "").strip(), markets)
        counts[verdict.state] += 1
        if verdict.state == UNKNOWN:
            print(f"  ? {c['isrc']} {track_id}: {verdict.reason}")
            continue
        row, event = next_state(prev_by_isrc.get(c["isrc"]), c, verdict, now_iso)
        upserts.append(row)
        if event:
            print(f"  ! {event}: {c['isrc']} {c.get('name')} ({verdict.reason})")
            new_events.append(
                {"isrc": c["isrc"], "spotify_track_id": track_id, "event": event, "reason": verdict.reason}
            )
        if i % 250 == 0:
            print(f"Checked {i}/{len(checkable)}...")

    new_takedowns = sum(1 for e in new_events if e["event"] == "taken_down")
    print(
        f"Done: available={counts[AVAILABLE]} unavailable={counts[UNAVAILABLE]} unknown={counts[UNKNOWN]} "
        f"new_takedowns={new_takedowns} restored={len(new_events) - new_takedowns}"
    )
    summary = [
        "## Spotify takedown watch",
        f"- Checked: {len(checkable)} (markets {', '.join(markets)}); skipped without Spotify id: {missing_ids}",
        f"- Available: {counts[AVAILABLE]} · Unavailable: {counts[UNAVAILABLE]} · Unknown: {counts[UNKNOWN]}",
        f"- New takedowns: {new_takedowns} · Restored: {len(new_events) - new_takedowns}",
    ]

    if checkable and counts[UNKNOWN] / len(checkable) > 0.5:
        msg = (
            f"{counts[UNKNOWN]} of {len(checkable)} checks gave no usable answer; the Spotify API "
            "may be refusing these calls (quota mode / endpoint change). Nothing written."
        )
        print(msg)
        write_step_summary("\n".join(summary + [f"- **{msg}**"]))
        return 3

    if not args.skip_safety_valve and is_suspicious_mass_takedown(
        new_takedowns, len(checkable), args.mass_min_count, args.mass_max_share
    ):
        msg = (
            f"Refusing to record {new_takedowns} new takedowns out of {len(checkable)} checked "
            f"(> {args.mass_max_share:.0%}); likely a Spotify API change or outage. Nothing written. "
            "If this is real (e.g. first run on a catalog with many dead tracks), re-run with --skip-safety-valve."
        )
        print(msg)
        write_step_summary("\n".join(summary + [f"- **{msg}**"]))
        return 2

    if args.dry_run:
        print("Dry run: no writes, no email.")
        write_step_summary("\n".join(summary + ["- Dry run: nothing written."]))
        return 0

    # Events first so a crash can't record a transition without its alert;
    # skip an event if the latest one for that ISRC already says the same thing.
    if new_events:
        since = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
        recent = pg.select_all(
            "spotify_track_availability_events",
            "isrc,event,detected_at",
            f"detected_at=gte.{quote(since)}",
            order="detected_at.asc",
        )
        latest_event = {r["isrc"]: r["event"] for r in recent}
        new_events = [e for e in new_events if latest_event.get(e["isrc"]) != e["event"]]
        if new_events:
            pg.insert("spotify_track_availability_events", new_events)
    for start in range(0, len(upserts), 500):
        pg.upsert("spotify_track_availability", upserts[start : start + 500], on_conflict="isrc")

    # Email everything not yet notified (also retries alerts from a run whose
    # email step failed).
    pending = pg.select_all(
        "spotify_track_availability_events",
        "id,isrc,spotify_track_id,event,reason,detected_at",
        "notified_at=is.null",
        order="id.asc",
    )
    if pending:
        missing_meta = [e["isrc"] for e in pending if e["isrc"] not in tracks_by_isrc]
        if missing_meta:
            for row in pg.select_all(
                "tracks",
                "isrc,name,spotify_artist_names",
                f"isrc=in.({','.join(quote(i) for i in missing_meta)})",
            ):
                tracks_by_isrc[row["isrc"]] = {"name": row.get("name"), "artist_names": row.get("spotify_artist_names")}
        subject, text_body, html_body = build_email(pending, tracks_by_isrc)
        recipient = (os.environ.get("TAKEDOWN_ALERT_TO") or DEFAULT_ALERT_TO).strip()
        send_email(recipient, subject, text_body, html_body)
        ids = ",".join(str(e["id"]) for e in pending)
        pg.patch("spotify_track_availability_events", {"notified_at": now_iso}, f"id=in.({ids})")
        print(f"Emailed {len(pending)} event(s) to {recipient}: {subject}")
        summary.append(f"- Emailed: {subject}")

    if new_events:
        notify_web_revalidate()  # refresh the Health panel now, not in an hour

    write_step_summary("\n".join(summary))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="Check and report without writing or emailing")
    ap.add_argument("--limit", type=int, default=0, help="Max tracks to check (0 = all)")
    ap.add_argument("--lookback-days", type=int, default=30, help="Catalog snapshot window defining 'own catalog'")
    ap.add_argument("--markets", default=os.environ.get("SPOTIFY_AVAILABILITY_MARKETS"), help="Comma list, e.g. US,GB,AE")
    ap.add_argument("--min-interval", type=float, default=0.15, help="Seconds between Spotify requests")
    ap.add_argument("--mass-min-count", type=int, default=25, help="Safety valve: minimum new takedowns to trip")
    ap.add_argument("--mass-max-share", type=float, default=0.10, help="Safety valve: max share of checked tracks")
    ap.add_argument("--skip-safety-valve", action="store_true", help="Record a mass takedown anyway")
    ap.add_argument("--track-id", help="Diagnose one Spotify track id (prints raw signals; no DB access)")
    ap.add_argument("--isrc", default="", help="ISRC for --track-id search confirmation")
    args = ap.parse_args()

    markets = parse_markets(args.markets)
    sp = Spotify(
        require_env("SPOTIFY_CLIENT_ID"),
        require_env("SPOTIFY_CLIENT_SECRET"),
        min_interval_s=args.min_interval,
    )
    if args.track_id:
        return run_single(sp, args.track_id.strip(), args.isrc.strip(), markets)

    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    return run(pg, sp, args, markets)


if __name__ == "__main__":
    raise SystemExit(main())
