"""
Auto-fix stale tracks via stream lookup providers.

Runs as a standalone scheduled job (separate from ingestion). Queries the DB
for the latest individual_tracks_stale warning, fetches corrected stream
counts from Beat Analytics first and Music Metrics as a fallback, and writes
overrides to track_daily_stream_overrides.

Caps at 70 API calls per day (per run_date) by default: 50 Beat Analytics
calls plus 20 Music Metrics calls. The existing user setting can lower the
overall cap.

Usage:
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="..."
    export BEAT_ANALYTICS_RAPIDAPI_KEY="..."
    export MUSIC_METRICS_RAPIDAPI_KEY="..."
    # Optional legacy fallback for both providers:
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

DAILY_CAP = 70
BEAT_ANALYTICS_DAILY_CAP = 50
MUSIC_METRICS_DAILY_CAP = 20
BEAT_ANALYTICS_HOST = "spotify-statistics-and-stream-count.p.rapidapi.com"
BEAT_ANALYTICS_ENDPOINT = f"https://{BEAT_ANALYTICS_HOST}/track"
MUSIC_METRICS_HOST = "spotify-track-streams-playback-count1.p.rapidapi.com"
MUSIC_METRICS_ENDPOINT = f"https://{MUSIC_METRICS_HOST}/tracks/spotify_track_streams"
OVERRIDE_NOTE_PREFIX = "stale-fix:"
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


def fetch_beat_analytics_streams(spotify_track_id: str, api_key: str) -> int | None:
    headers = {
        "x-rapidapi-host": BEAT_ANALYTICS_HOST,
        "x-rapidapi-key": api_key,
        "Content-Type": "application/json",
    }
    r = requests.get(f"{BEAT_ANALYTICS_ENDPOINT}/{spotify_track_id}", headers=headers, timeout=30)
    data = r.json() if r.ok else {}
    if data.get("streamCount") is None:
        return None
    val = int(data["streamCount"])
    return val if val >= 0 else None


def fetch_music_metrics_streams(isrc: str, api_key: str) -> int | None:
    headers = {
        "x-rapidapi-host": MUSIC_METRICS_HOST,
        "x-rapidapi-key": api_key,
    }
    r = requests.get(MUSIC_METRICS_ENDPOINT, headers=headers, params={"isrc": isrc}, timeout=30)
    data = r.json() if r.ok else {}
    if data.get("result") != "success" or data.get("streams") is None:
        return None
    val = int(data["streams"])
    return val if val >= 0 else None


def attach_spotify_track_ids(pg: Postgrest, candidates: list) -> list:
    isrcs = [str(c.get("isrc", "")).strip().upper() for c in candidates if c.get("isrc")]
    if not isrcs:
        return candidates

    try:
        rows = pg.select(
            "tracks",
            "isrc,spotify_track_id",
            f"isrc=in.({','.join(isrcs)})",
        )
    except Exception as e:
        print(f"Warning: could not load Spotify track IDs ({e}).")
        return candidates

    spotify_by_isrc = {
        str(row.get("isrc", "")).strip().upper(): str(row.get("spotify_track_id") or "").strip()
        for row in rows
    }
    return [
        {**c, "spotify_track_id": spotify_by_isrc.get(str(c.get("isrc", "")).strip().upper()) or None}
        for c in candidates
    ]


def today_usage(pg: Postgrest, run_date: str, existing: list) -> dict:
    try:
        rows = pg.select(
            "stream_lookup_usage",
            "provider,calls",
            f"usage_date=eq.{run_date}",
        )
        usage = {"beat_analytics": 0, "music_metrics": 0}
        for row in rows:
            provider = str(row.get("provider") or "")
            if provider in usage:
                usage[provider] = int(row.get("calls") or 0)
        return usage
    except Exception:
        return {
            "beat_analytics": sum(1 for r in existing if "Beat Analytics" in str(r.get("note", ""))),
            "music_metrics": sum(1 for r in existing if "Music Metrics" in str(r.get("note", ""))),
        }


def record_provider_call(pg: Postgrest, run_date: str, provider: str, current_usage: dict):
    current_usage[provider] = int(current_usage.get(provider, 0)) + 1
    try:
        pg.upsert(
            "stream_lookup_usage",
            [
                {
                    "usage_date": run_date,
                    "provider": provider,
                    "calls": current_usage[provider],
                }
            ],
            "usage_date,provider",
        )
    except Exception:
        pass


def enrich_fixed_tracks(pg: Postgrest, fixed: list) -> list:
    if not fixed:
        return fixed

    isrcs = [str(f.get("isrc", "")).strip().upper() for f in fixed if f.get("isrc")]
    if not isrcs:
        return fixed

    try:
        rows = pg.select(
            "tracks",
            "isrc,name,spotify_artist_names,spotify_album_image_url",
            f"isrc=in.({','.join(isrcs)})",
        )
    except Exception as e:
        print(f"Warning: could not enrich fixed track metadata ({e}).")
        return fixed

    meta_by_isrc = {}
    for row in rows:
        isrc = str(row.get("isrc", "")).strip().upper()
        if not isrc:
            continue
        artist_names = row.get("spotify_artist_names")
        if not isinstance(artist_names, list):
            artist_names = None
        meta_by_isrc[isrc] = {
            "track_name": row.get("name") or None,
            "artist_names": artist_names,
            "album_image_url": row.get("spotify_album_image_url") or None,
        }

    return [
        {**f, **meta_by_isrc.get(str(f.get("isrc", "")).strip().upper(), {})}
        for f in fixed
    ]


def main():
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    legacy_api_key = os.environ.get("RAPIDAPI_KEY", "").strip()
    beat_key = os.environ.get("BEAT_ANALYTICS_RAPIDAPI_KEY", "").strip() or legacy_api_key
    music_key = os.environ.get("MUSIC_METRICS_RAPIDAPI_KEY", "").strip() or legacy_api_key

    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        sys.exit(1)
    if not beat_key and not music_key:
        print("No stream lookup provider key is set. Skipping stale-fix.")
        sys.exit(0)

    pg = Postgrest(supabase_url, service_key)

    daily_cap = DAILY_CAP
    try:
        settings_rows = pg.select(
            "user_settings",
            "rapidapi_auto_fix_enabled,rapidapi_auto_fix_daily_cap",
            "limit=1",
        )
        if settings_rows:
            row = settings_rows[0]
            if row.get("rapidapi_auto_fix_enabled") is False:
                print("Stream lookup auto-fix is disabled in settings. Skipping.")
                write_summary("", 0, 0, [])
                sys.exit(0)
            cap_val = row.get("rapidapi_auto_fix_daily_cap")
            if isinstance(cap_val, int) and 1 <= cap_val <= 1000:
                daily_cap = min(cap_val, DAILY_CAP)
    except Exception as e:
        print(f"Warning: could not read auto-fix settings ({e}). Using defaults.")

    print(
        f"Daily free cap: {daily_cap} "
        f"(Beat Analytics {BEAT_ANALYTICS_DAILY_CAP}/day + Music Metrics {MUSIC_METRICS_DAILY_CAP}/day)"
    )

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

    existing = pg.select(
        "track_daily_stream_overrides",
        "isrc,note",
        f"date=eq.{run_date}&note=like.{OVERRIDE_NOTE_PREFIX}*auto*",
    )
    existing_isrcs = {str(r.get("isrc", "")).strip().upper() for r in existing}
    usage_date = datetime.now(timezone.utc).date().isoformat()
    usage = today_usage(pg, usage_date, existing)
    existing_beat = usage["beat_analytics"]
    existing_music = usage["music_metrics"]
    already_fixed = len(existing_isrcs)
    budget = max(0, daily_cap - already_fixed)
    beat_budget = max(0, min(BEAT_ANALYTICS_DAILY_CAP - existing_beat, budget))
    music_budget = max(0, min(MUSIC_METRICS_DAILY_CAP - existing_music, budget))

    print(f"  Already fixed today: {already_fixed}/{daily_cap} | Budget remaining: {budget}")
    print(f"  Provider budget: Beat Analytics={beat_budget}, Music Metrics={music_budget}")

    if budget <= 0:
        print("Daily cap reached. Exiting.")
        write_summary(run_date, 0, 0, [])
        sys.exit(0)

    candidates = []
    for t in affected_tracks:
        isrc = str(t.get("isrc", "")).strip().upper()
        streams = int(t.get("streams_cumulative", 0))
        if not isrc or isrc in existing_isrcs:
            continue
        candidates.append({"isrc": isrc, "stale_streams": streams})
    candidates = attach_spotify_track_ids(pg, candidates[:budget])

    if not candidates:
        print("All stale tracks already fixed or none eligible. Nothing to do.")
        write_summary(run_date, 0, 0, [])
        sys.exit(0)

    print(f"  Fetching stream counts for {len(candidates)} track(s)...")

    fixed: List[dict] = []
    attempted = 0
    beat_attempted = 0
    music_attempted = 0

    for i, c in enumerate(candidates):
        isrc = c["isrc"]
        stale = c["stale_streams"]
        attempted += 1
        api_val = None
        provider = None

        if beat_key and c.get("spotify_track_id") and beat_attempted < beat_budget:
            beat_attempted += 1
            record_provider_call(pg, usage_date, "beat_analytics", usage)
            try:
                api_val = fetch_beat_analytics_streams(c["spotify_track_id"], beat_key)
                if api_val is not None:
                    provider = "Beat Analytics"
            except Exception as e:
                print(f"    {isrc}: Beat Analytics error - {e}")

        if api_val is None and music_key and music_attempted < music_budget:
            music_attempted += 1
            record_provider_call(pg, usage_date, "music_metrics", usage)
            try:
                api_val = fetch_music_metrics_streams(isrc, music_key)
                if api_val is not None:
                    provider = "Music Metrics"
            except Exception as e:
                print(f"    {isrc}: Music Metrics error - {e}")

        if api_val is None:
            print(f"    {isrc}: no data from stream providers")
        elif api_val < stale:
            print(f"    {isrc}: suspicious ({provider}={api_val:,} < stale={stale:,}), skipping")
        else:
            delta = api_val - stale
            print(f"    {isrc}: OK stale={stale:,} -> {provider}={api_val:,} (+{delta:,})")
            fixed.append({"isrc": isrc, "streams": api_val, "stale": stale, "provider": provider})

        if i < len(candidates) - 1:
            time.sleep(RATE_LIMIT_MS / 1000)

    if fixed:
        rows = [
            {
                "date": run_date,
                "isrc": f["isrc"],
                "streams_cumulative_override": f["streams"],
                "note": f"stale-fix: {f.get('provider') or 'stream lookup'} auto",
            }
            for f in fixed
        ]
        pg.upsert("track_daily_stream_overrides", rows, "date,isrc")
        print(f"\n  Wrote {len(fixed)} override(s). Triggering recompute...")

        pg.rpc("spotibase_recompute_playlist_daily_stats_cascade", {"p_start_date": run_date})
        print("  Recompute complete.")
    else:
        print("\n  No overrides to write.")

    fixed = enrich_fixed_tracks(pg, fixed)
    print(f"\nDone. Attempted={attempted}, Fixed={len(fixed)}")
    write_summary(run_date, attempted, len(fixed), fixed)


def write_summary(run_date: str, attempted: int, fixed_count: int, fixed: list):
    summary = {
        "run_date": run_date,
        "attempted": attempted,
        "fixed": fixed_count,
        "tracks": [
            {
                "isrc": f["isrc"],
                "track_name": f.get("track_name"),
                "artist_names": f.get("artist_names"),
                "album_image_url": f.get("album_image_url"),
                "stale": f["stale"],
                "new": f["streams"],
                "provider": f.get("provider"),
            }
            for f in fixed
        ],
    }
    out = Path(".artifacts") / "stale_fix_summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
