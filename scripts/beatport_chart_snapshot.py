#!/usr/bin/env python3
"""Daily snapshot of public Beatport charts into the `charts` schema.

Policy (owner decision): ONE plain GET per chart per day with an honest
User-Agent. No browser automation, no proxies, no header spoofing, no evasion.
Network errors / 5xx / missing data get 3 attempts (backoff 5s, 20s); a 403 or
429 is retried at most once.

Per chart the run validates the parsed list first and writes nothing when the
page looks wrong. Write order: tracks -> snapshot -> delete same-day entries ->
insert entries (so a same-day re-run replaces the snapshot).

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import date, datetime, timezone
from typing import Any, Callable, Dict, List, Optional

import requests

from streambase_postgrest import Postgrest
from streambase_revalidate import notify_web_revalidate

USER_AGENT = "StreamBase-ChartSnapshot/1.0 (personal analytics; daily)"
SOURCE = "beatport"
MIN_ENTRIES = 90
BACKOFF_SECONDS = (5, 20)
MAX_ATTEMPTS = 3
REQUEST_TIMEOUT_S = 30
NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)


class ChartParseError(Exception):
    """The page did not contain the expected chart data (retryable)."""


class ChartValidationError(Exception):
    """The parsed chart looks wrong (not retryable, nothing is written)."""


class ChartFetchError(Exception):
    pass


def _name_list(items: Any) -> List[str]:
    out: List[str] = []
    for item in items or []:
        name = item.get("name") if isinstance(item, dict) else None
        if isinstance(name, str) and name.strip():
            out.append(name.strip())
    return out


def _to_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _find_results(next_data: dict) -> List[dict]:
    try:
        queries = next_data["props"]["pageProps"]["dehydratedState"]["queries"]
    except (KeyError, TypeError):
        raise ChartParseError("dehydratedState.queries not found")
    fallback: Optional[List[dict]] = None
    for q in queries or []:
        try:
            data = q["state"]["data"]
        except (KeyError, TypeError):
            continue
        results = data.get("results") if isinstance(data, dict) else None
        if not (isinstance(results, list) and results and all(isinstance(r, dict) for r in results)):
            continue
        if not any("isrc" in r for r in results):
            continue
        key = q.get("queryKey") or [""]
        if isinstance(key[0], str) and key[0].startswith("genre-") and "top-100-tracks" in key[0]:
            return results
        if fallback is None:
            fallback = results
    if fallback is not None:
        return fallback
    raise ChartParseError("no tracks result list found in __NEXT_DATA__")


def parse_item(item: dict, position: int) -> dict:
    """One Beatport result item -> {'position', 'track'} (track = charts.tracks row sans dates)."""
    key = item.get("key") if isinstance(item.get("key"), dict) else {}
    release = item.get("release") if isinstance(item.get("release"), dict) else {}
    label = release.get("label") if isinstance(release.get("label"), dict) else {}
    image = release.get("image") if isinstance(release.get("image"), dict) else {}
    dynamic = image.get("dynamic_uri")
    image_url = dynamic.replace("{w}x{h}", "200x200") if isinstance(dynamic, str) else None
    camelot = None
    if key.get("camelot_number") is not None and key.get("camelot_letter"):
        camelot = f"{key['camelot_number']}{key['camelot_letter']}"
    track_id = _to_int(item.get("id"))
    slug = item.get("slug")
    track_url = (
        f"https://www.beatport.com/track/{slug}/{track_id}" if slug and track_id is not None else None
    )
    release_date = item.get("new_release_date") or item.get("publish_date") or None
    return {
        "position": position,
        "track": {
            "source": SOURCE,
            "source_track_id": track_id,
            "isrc": item.get("isrc") or None,
            "name": item.get("name"),
            "mix_name": item.get("mix_name") or None,
            "artists": _name_list(item.get("artists")),
            "remixers": _name_list(item.get("remixers")),
            "label_name": label.get("name") or None,
            "release_name": release.get("name") or None,
            "release_date": release_date,
            "bpm": _to_int(item.get("bpm")),
            "musical_key": key.get("name") or None,
            "camelot": camelot,
            "length_ms": _to_int(item.get("length_ms")),
            "image_url": image_url,
            "track_url": track_url,
        },
    }


def parse_chart_html(html: str) -> List[dict]:
    m = NEXT_DATA_RE.search(html or "")
    if not m:
        raise ChartParseError("__NEXT_DATA__ script not found")
    try:
        next_data = json.loads(m.group(1))
    except json.JSONDecodeError as exc:
        raise ChartParseError(f"__NEXT_DATA__ is not valid JSON: {exc}")
    results = _find_results(next_data)
    return [parse_item(item, idx + 1) for idx, item in enumerate(results)]


def validate_entries(entries: List[dict], min_entries: int = MIN_ENTRIES) -> None:
    n = len(entries)
    if n < min_entries:
        raise ChartValidationError(f"only {n} entries (need >= {min_entries})")
    positions = [e["position"] for e in entries]
    if len(set(positions)) != n or sorted(positions) != list(range(1, n + 1)):
        raise ChartValidationError("positions are not unique 1..N")
    for e in entries:
        t = e["track"]
        if not isinstance(t.get("source_track_id"), int):
            raise ChartValidationError(f"position {e['position']}: missing integer id")
        if not (isinstance(t.get("name"), str) and t["name"].strip()):
            raise ChartValidationError(f"position {e['position']}: missing name")
    ids = [e["track"]["source_track_id"] for e in entries]
    if len(set(ids)) != n:
        raise ChartValidationError("duplicate track ids in chart")


def fetch_chart_entries(
    url: str,
    *,
    http_get: Callable[..., Any] = requests.get,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> List[dict]:
    """Fetch and parse one chart page with the documented retry policy."""
    blocked_retries = 0
    last: Optional[BaseException] = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = http_get(url, headers={"User-Agent": USER_AGENT}, timeout=REQUEST_TIMEOUT_S)
            status = resp.status_code
            if status in (403, 429):
                last = ChartFetchError(f"HTTP {status}")
                if blocked_retries >= 1:
                    raise last
                blocked_retries += 1
            elif status >= 500:
                last = ChartFetchError(f"HTTP {status}")
            elif status != 200:
                raise ChartFetchError(f"HTTP {status}")
            else:
                return parse_chart_html(resp.text)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last = exc
        except ChartParseError as exc:
            last = exc
        if attempt >= MAX_ATTEMPTS - 1:
            break
        delay = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
        log(f"[beatport] attempt {attempt + 1} failed ({last}); retrying in {delay}s")
        sleep(delay)
    assert last is not None
    raise last if isinstance(last, ChartFetchError) else ChartFetchError(str(last))


def write_snapshot(
    pg: Any, chart_key: str, entries: List[dict], today: date, now: datetime
) -> None:
    """tracks -> snapshot -> delete same-day entries -> insert entries."""
    today_s = today.isoformat()
    tracks_by_id: Dict[int, dict] = {e["track"]["source_track_id"]: e["track"] for e in entries}
    ids = sorted(tracks_by_id)

    existing_first: Dict[int, str] = {}
    id_list = ",".join(str(i) for i in ids)
    for row in pg.select(
        "tracks", "source_track_id,first_seen", f"source=eq.{SOURCE}&source_track_id=in.({id_list})"
    ):
        existing_first[int(row["source_track_id"])] = str(row["first_seen"])[:10]

    track_rows = []
    for tid in ids:
        row = dict(tracks_by_id[tid])
        row["first_seen"] = min(existing_first.get(tid, today_s), today_s)
        row["last_seen"] = today_s
        row["updated_at"] = now.isoformat()
        track_rows.append(row)
    pg.upsert("tracks", track_rows, on_conflict="source,source_track_id")

    pg.upsert(
        "snapshots",
        [
            {
                "chart_key": chart_key,
                "snapshot_date": today_s,
                "entry_count": len(entries),
                "captured_at": now.isoformat(),
            }
        ],
        on_conflict="chart_key,snapshot_date",
    )
    pg.delete("entries", f"chart_key=eq.{chart_key}&snapshot_date=eq.{today_s}")
    pg.insert(
        "entries",
        [
            {
                "chart_key": chart_key,
                "snapshot_date": today_s,
                "position": e["position"],
                "source": SOURCE,
                "source_track_id": e["track"]["source_track_id"],
            }
            for e in entries
        ],
    )


def process_chart(
    chart: dict,
    pg: Optional[Any],
    *,
    html_file: Optional[str] = None,
    dry_run: bool = False,
    http_get: Callable[..., Any] = requests.get,
    sleep: Callable[[float], None] = time.sleep,
    today: Optional[date] = None,
    now: Optional[datetime] = None,
) -> int:
    key = chart["chart_key"]
    if html_file:
        with open(html_file, encoding="utf-8") as fh:
            entries = parse_chart_html(fh.read())
    else:
        entries = fetch_chart_entries(chart["url"], http_get=http_get, sleep=sleep)
    validate_entries(entries)
    if dry_run:
        for e in entries[:10]:
            t = e["track"]
            print(f"  {e['position']:>3}  {', '.join(t['artists'])} - {t['name']} ({t['mix_name']})  [{t['label_name']}]")
        print(f"[beatport] {key}: {len(entries)} entries parsed (dry run, nothing written)")
        return len(entries)
    assert pg is not None
    now = now or datetime.now(timezone.utc)
    today = today or now.date()
    write_snapshot(pg, key, entries, today, now)
    print(f"[beatport] {key}: wrote snapshot {today.isoformat()} with {len(entries)} entries")
    return len(entries)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="parse and print, write nothing")
    ap.add_argument("--html-file", help="parse a local HTML file instead of fetching")
    args = ap.parse_args(argv)

    pg: Optional[Postgrest] = None
    charts: List[dict]
    if args.dry_run and args.html_file:
        charts = [{"chart_key": "local_html", "url": ""}]
    else:
        url = (os.environ.get("SUPABASE_URL") or "").strip()
        key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        if not url or not key:
            print("Missing env var: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
            return 2
        pg = Postgrest(url, key, schema="charts")
        charts = pg.select(
            "charts", "chart_key,url", f"source=eq.{SOURCE}&is_active=is.true&order=chart_key.asc"
        )
        if not charts:
            print("[beatport] no active charts configured")
            return 0

    failures = 0
    wrote = False
    for chart in charts:
        try:
            process_chart(chart, pg, html_file=args.html_file, dry_run=args.dry_run)
            wrote = wrote or not args.dry_run
        except Exception as exc:  # one failing chart must not block the others
            failures += 1
            print(f"[beatport] {chart['chart_key']} FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)

    if wrote:
        notify_web_revalidate()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
