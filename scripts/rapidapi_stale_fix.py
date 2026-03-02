"""
Auto-fix stale tracks via RapidAPI.

Runs as a standalone scheduled job (separate from ingestion). Queries the DB
for the latest individual_tracks_stale warning, fetches corrected stream
counts from RapidAPI, and writes overrides to track_daily_stream_overrides.

Caps at 20 API calls per day (per run_date) to stay within the free tier.

Usage:
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="..."
    export RAPIDAPI_KEY="..."

    python scripts/rapidapi_stale_fix.py
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import requests

DAILY_CAP = 20
RAPIDAPI_HOST = "spotify-track-streams-playback-count1.p.rapidapi.com"
RAPIDAPI_ENDPOINT = f"https://{RAPIDAPI_HOST}/tracks/spotify_track_streams"
OVERRIDE_NOTE = "stale-fix: RapidAPI auto"
RATE_LIMIT_MS = 1100


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
        }

    def select(self, table: str, select: str, filters: str) -> list:
        url = f"{self.base}/{table}?select={select}&{filters}"
        r = requests.get(url, headers=self.h, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def upsert(self, table: str, rows: list, on_conflict: str):
        if not rows:
            return
        url = f"{self.base}/{table}?on_conflict={on_conflict}"
        headers = dict(self.h)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        r = requests.post(url, headers=headers, data=json.dumps(rows), timeout=60)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Upsert {table} failed: {r.status_code} {r.text[:500]}")

    def rpc(self, fn_name: str, params: dict):
        url = f"{self.base.rsplit('/rest/v1', 1)[0]}/rest/v1/rpc/{fn_name}"
        r = requests.post(url, headers=self.h, data=json.dumps(params), timeout=180)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"RPC {fn_name} failed: {r.status_code} {r.text[:500]}")


def fetch_rapidapi_streams(isrc: str, api_key: str) -> int | None:
    headers = {
        "x-rapidapi-host": RAPIDAPI_HOST,
        "x-rapidapi-key": api_key,
    }
    r = requests.get(RAPIDAPI_ENDPOINT, headers=headers, params={"isrc": isrc}, timeout=30)
    data = r.json() if r.ok else {}
    if data.get("result") != "success" or data.get("streams") is None:
        return None
    val = int(data["streams"])
    return val if val >= 0 else None


def main():
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    api_key = os.environ.get("RAPIDAPI_KEY", "").strip()

    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        sys.exit(1)
    if not api_key:
        print("RAPIDAPI_KEY is not set. Skipping stale-fix.")
        sys.exit(0)

    pg = Postgrest(supabase_url, service_key)

    # Find the latest individual_tracks_stale warning.
    warnings = pg.select(
        "ingestion_warnings",
        "run_date,details_json",
        "code=eq.individual_tracks_stale&order=run_date.desc&limit=1",
    )
    if not warnings:
        print("No individual_tracks_stale warning found. Nothing to do.")
        sys.exit(0)

    warning = warnings[0]
    run_date = str(warning.get("run_date", "")).strip()
    details = warning.get("details_json") or {}
    affected_tracks: List[dict] = details.get("affected_tracks", [])

    if not run_date or not affected_tracks:
        print(f"Warning found for {run_date} but no affected tracks. Nothing to do.")
        sys.exit(0)

    print(f"Found {len(affected_tracks)} stale track(s) for run_date={run_date}")

    # Check how many auto-fixes already exist for this run date.
    existing = pg.select(
        "track_daily_stream_overrides",
        "isrc",
        f"date=eq.{run_date}&note=eq.{OVERRIDE_NOTE}",
    )
    existing_isrcs = {str(r.get("isrc", "")).strip().upper() for r in existing}
    already_fixed = len(existing_isrcs)
    budget = max(0, DAILY_CAP - already_fixed)

    print(f"  Already fixed today: {already_fixed}/{DAILY_CAP}  |  Budget remaining: {budget}")

    if budget <= 0:
        print("Daily cap reached. Exiting.")
        write_summary(run_date, 0, 0, [])
        sys.exit(0)

    # Filter out tracks that are already overridden, take up to budget.
    candidates = []
    for t in affected_tracks:
        isrc = str(t.get("isrc", "")).strip().upper()
        streams = int(t.get("streams_cumulative", 0))
        if not isrc or isrc in existing_isrcs:
            continue
        candidates.append({"isrc": isrc, "stale_streams": streams})
    candidates = candidates[:budget]

    if not candidates:
        print("All stale tracks already fixed or none eligible. Nothing to do.")
        write_summary(run_date, 0, 0, [])
        sys.exit(0)

    print(f"  Fetching from RapidAPI for {len(candidates)} track(s)...")

    fixed: List[dict] = []
    attempted = 0

    for i, c in enumerate(candidates):
        isrc = c["isrc"]
        stale = c["stale_streams"]
        attempted += 1

        try:
            api_val = fetch_rapidapi_streams(isrc, api_key)
        except Exception as e:
            print(f"    {isrc}: API error — {e}")
            if i < len(candidates) - 1:
                time.sleep(RATE_LIMIT_MS / 1000)
            continue

        if api_val is None:
            print(f"    {isrc}: no data from API")
        elif api_val < stale:
            print(f"    {isrc}: suspicious (API={api_val:,} < stale={stale:,}), skipping")
        else:
            delta = api_val - stale
            print(f"    {isrc}: OK  stale={stale:,} → API={api_val:,}  (+{delta:,})")
            fixed.append({"isrc": isrc, "streams": api_val, "stale": stale})

        if i < len(candidates) - 1:
            time.sleep(RATE_LIMIT_MS / 1000)

    # Write overrides.
    if fixed:
        rows = [
            {
                "date": run_date,
                "isrc": f["isrc"],
                "streams_cumulative_override": f["streams"],
                "note": OVERRIDE_NOTE,
            }
            for f in fixed
        ]
        pg.upsert("track_daily_stream_overrides", rows, "date,isrc")
        print(f"\n  Wrote {len(fixed)} override(s). Triggering recompute...")

        pg.rpc("spotibase_recompute_playlist_daily_stats_cascade", {"p_start_date": run_date})
        print("  Recompute complete.")
    else:
        print("\n  No overrides to write.")

    print(f"\nDone. Attempted={attempted}, Fixed={len(fixed)}")
    write_summary(run_date, attempted, len(fixed), fixed)


def write_summary(run_date: str, attempted: int, fixed_count: int, fixed: list):
    summary = {
        "run_date": run_date,
        "attempted": attempted,
        "fixed": fixed_count,
        "tracks": [{"isrc": f["isrc"], "stale": f["stale"], "new": f["streams"]} for f in fixed],
    }
    out = Path(".artifacts") / "stale_fix_summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
