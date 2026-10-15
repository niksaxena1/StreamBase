"""
Auto-fix stale tracks via stream lookup providers.

Runs as a standalone scheduled job (separate from ingestion). Queries the DB
for the latest individual_tracks_stale warning, fetches corrected stream
counts from Beat Analytics first, Music Metrics second, MusicAnalytics third,
and CheckLeakedCC fourth, then writes overrides to track_daily_stream_overrides.

Repairs all stale tracks while the batch is below the 500-track safety
threshold. Automated runs only use free provider quotas and never paid overage.

Second look (``--second-look`` or ``SECOND_LOOK=true``): started about six hours after the
morning ingest. It re-checks only tracks of today's stale warning that are still stale (today's
effective value not above yesterday's) and have no override of any kind, with the same free
providers inside their remaining daily/monthly caps. Notes get a "; second-look" marker.

Every run (first pass or second look) never touches a date/ISRC that already has an override
(manual and artist.tools fixes always win), never lowers a value, and chooses the highest
plausible candidate via ``stream_consolidation`` (floor = previous day, cap = 5x the trailing
7-day gain). Rejected candidates are logged to ``stream_consolidation_rejects`` and counted per
source in ``stream_source_quality_daily``.

Usage:
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="..."
    export BEAT_ANALYTICS_RAPIDAPI_KEY="..."
    export MUSIC_METRICS_RAPIDAPI_KEY="..."
    export MUSIC_ANALYTICS_RAPIDAPI_KEY="..."
    export CHECKLEAKEDCC_RAPIDAPI_KEY="..."
    # Optional legacy fallback for both providers:
    export RAPIDAPI_KEY="..."

    python scripts/rapidapi_stale_fix.py
"""

import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List

import requests
from streambase_postgrest import Postgrest
from streambase_home_snapshots import refresh_own_home_snapshots
import stream_consolidation as sc

MAX_AUTO_FIX_TRACKS = 500
BEAT_ANALYTICS_DAILY_CAP = 50
MUSIC_METRICS_DAILY_CAP = 20
MUSIC_ANALYTICS_MONTHLY_CAP = 50
CHECKLEAKEDCC_MONTHLY_CAP = 1000
BEAT_ANALYTICS_HOST = "spotify-statistics-and-stream-count.p.rapidapi.com"
BEAT_ANALYTICS_ENDPOINT = f"https://{BEAT_ANALYTICS_HOST}/track"
MUSIC_METRICS_HOST = "spotify-track-streams-playback-count1.p.rapidapi.com"
MUSIC_METRICS_ENDPOINT = f"https://{MUSIC_METRICS_HOST}/tracks/spotify_track_streams"
MUSIC_ANALYTICS_HOST = "spotify-stream-count.p.rapidapi.com"
MUSIC_ANALYTICS_ENDPOINT = f"https://{MUSIC_ANALYTICS_HOST}/v1/spotify/tracks"
CHECKLEAKEDCC_HOST = "spotify81.p.rapidapi.com"
CHECKLEAKEDCC_ENDPOINT = f"https://{CHECKLEAKEDCC_HOST}/partner/track/count"
OVERRIDE_NOTE_PREFIX = "stale-fix:"
ARTIST_TOOLS_SOURCE = "artist.tools"
HISTORY_CHUNK = 80
RATE_LIMIT_MS = 1100
REQUEST_TIMEOUT_SECONDS = 12
OVERRIDE_FLUSH_BATCH_SIZE = 25
MAX_RUNTIME_SECONDS = 40 * 60


def fetch_beat_analytics_streams(spotify_track_id: str, api_key: str) -> int | None:
    headers = {
        "x-rapidapi-host": BEAT_ANALYTICS_HOST,
        "x-rapidapi-key": api_key,
        "Content-Type": "application/json",
    }
    r = requests.get(
        f"{BEAT_ANALYTICS_ENDPOINT}/{spotify_track_id}",
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
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
    r = requests.get(
        MUSIC_METRICS_ENDPOINT,
        headers=headers,
        params={"isrc": isrc},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    data = r.json() if r.ok else {}
    if data.get("result") != "success" or data.get("streams") is None:
        return None
    val = int(data["streams"])
    return val if val >= 0 else None


def fetch_checkleakedcc_streams(spotify_track_id: str, isrc: str, api_key: str) -> int | None:
    headers = {
        "x-rapidapi-host": CHECKLEAKEDCC_HOST,
        "x-rapidapi-key": api_key,
        "Content-Type": "application/json",
    }
    r = requests.get(
        CHECKLEAKEDCC_ENDPOINT,
        headers=headers,
        params={"spotify_track_id": spotify_track_id, "isrc": isrc},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    data = r.json() if r.ok else {}
    if data.get("result") != "success" or data.get("streams") is None:
        return None
    val = int(data["streams"])
    return val if val >= 0 else None


def fetch_music_analytics_streams(spotify_track_id: str, api_key: str) -> int | None:
    headers = {
        "x-rapidapi-host": MUSIC_ANALYTICS_HOST,
        "x-rapidapi-key": api_key,
        "Content-Type": "application/json",
    }
    r = requests.get(
        f"{MUSIC_ANALYTICS_ENDPOINT}/{spotify_track_id}/streams/current",
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    data = r.json() if r.ok else {}
    raw = (
        data.get("streams")
        or data.get("streamCount")
        or data.get("current_stream_count")
        or data.get("currentStreamCount")
    )
    if raw is None:
        return None
    val = int(raw)
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


def usage_for_period(pg: Postgrest, run_date: str, existing: list) -> dict:
    try:
        month_start = f"{run_date[:7]}-01"
        rows = pg.select(
            "stream_lookup_usage",
            "usage_date,provider,calls",
            f"usage_date=gte.{month_start}&usage_date=lte.{run_date}",
        )
        usage = {"music_analytics": 0, "checkleakedcc": 0, "beat_analytics": 0, "music_metrics": 0}
        for row in rows:
            provider = str(row.get("provider") or "")
            if provider in ("music_analytics", "checkleakedcc"):
                usage[provider] += int(row.get("calls") or 0)
            elif provider in ("beat_analytics", "music_metrics") and str(row.get("usage_date")) == run_date:
                usage[provider] = int(row.get("calls") or 0)
        return usage
    except Exception:
        return {
            "music_analytics": sum(1 for r in existing if "MusicAnalytics" in str(r.get("note", ""))),
            "checkleakedcc": sum(1 for r in existing if "CheckLeakedCC" in str(r.get("note", ""))),
            "beat_analytics": sum(1 for r in existing if "Beat Analytics" in str(r.get("note", ""))),
            "music_metrics": sum(1 for r in existing if "Music Metrics" in str(r.get("note", ""))),
        }


_TODAY_CALLS: dict = {}


def record_provider_call(pg: Postgrest, run_date: str, provider: str, current_usage: dict):
    # current_usage holds the quota view (month-to-date for monthly providers); the stored row
    # for run_date must hold only that day's calls, or summing the month double-counts.
    current_usage[provider] = int(current_usage.get(provider, 0)) + 1
    key = (run_date, provider)
    if key not in _TODAY_CALLS:
        try:
            rows = pg.select("stream_lookup_usage", "calls",
                             f"usage_date=eq.{run_date}&provider=eq.{provider}&limit=1")
            _TODAY_CALLS[key] = int(rows[0].get("calls") or 0) if rows else 0
        except Exception:
            _TODAY_CALLS[key] = 0
    _TODAY_CALLS[key] += 1
    try:
        pg.upsert(
            "stream_lookup_usage",
            [
                {
                    "usage_date": run_date,
                    "provider": provider,
                    "calls": _TODAY_CALLS[key],
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


def build_override_rows(run_date: str, fixed: list) -> list:
    return [
        {
            "date": run_date,
            "isrc": f["isrc"],
            "streams_cumulative_override": f["streams"],
            "note": f.get("note") or f"stale-fix: {f.get('provider') or 'stream lookup'} auto",
        }
        for f in fixed
    ]


def flush_override_batch(pg: Postgrest, run_date: str, pending: list) -> int:
    if not pending:
        return 0
    pg.upsert("track_daily_stream_overrides", build_override_rows(run_date, pending), "date,isrc")
    flushed = len(pending)
    pending.clear()
    return flushed


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def load_effective_history(pg: Postgrest, run_date: str, isrcs: list) -> dict:
    """{isrc: [(date, effective cumulative)]} for the 8 days up to and including run_date. Best effort."""
    out: dict = {}
    start = (date.fromisoformat(run_date) - timedelta(days=sc.TRAILING_DAYS + 1)).isoformat()
    for chunk in _chunks(isrcs, HISTORY_CHUNK):
        try:
            rows = pg.select(
                "track_daily_streams_effective_public",
                "isrc,date,streams_cumulative",
                f"date=gte.{start}&date=lte.{run_date}&isrc=in.({','.join(chunk)})",
            )
        except Exception as e:
            print(f"Warning: could not load stream history ({e}); plausibility cap skipped for a batch.")
            continue
        for isrc, points in sc.rows_by_isrc(rows).items():
            out.setdefault(isrc, []).extend(points)
    return out


def load_artist_tools_observations(pg: Postgrest, run_date: str, isrcs: list) -> dict:
    """{isrc: streams} recorded by artist.tools for run_date. Best effort."""
    out: dict = {}
    for chunk in _chunks(isrcs, HISTORY_CHUNK):
        try:
            rows = pg.select(
                "artist_tools_track_streams",
                "isrc,streams",
                f"date=eq.{run_date}&isrc=in.({','.join(chunk)})",
            )
        except Exception:
            continue
        for row in rows:
            isrc = str(row.get("isrc") or "").strip().upper()
            if isrc and row.get("streams") is not None:
                out[isrc] = int(row["streams"])
    return out


def record_source_quality(pg: Postgrest, run_date: str, stats: dict, rejects: list) -> None:
    """Persist per-source attempts/rejects and the reject log. Never raises."""
    for source, st in stats.items():
        if not st["attempts"] and not st["rejects"]:
            continue
        try:
            pg.rpc(
                "record_stream_source_attempts",
                {
                    "p_date": run_date,
                    "p_source": source,
                    "p_attempts": st["attempts"],
                    "p_rejects": st["rejects"],
                },
                idempotent=False,
            )
        except Exception as e:
            print(f"Warning: could not record source quality for {source} ({e}).")
    if rejects:
        rows = [
            {
                "date": run_date,
                "isrc": r["isrc"],
                "source": r["source"],
                "value": r["value"],
                "reason": r["reason"],
                "prev_value": r["prev_value"],
                "cap_value": r["cap_value"],
            }
            for r in rejects
        ]
        try:
            pg.upsert("stream_consolidation_rejects", rows, "date,isrc,source")
        except Exception as e:
            print(f"Warning: could not log consolidation rejects ({e}).")


def is_second_look() -> bool:
    return "--second-look" in sys.argv or os.environ.get("SECOND_LOOK", "").strip().lower() in ("1", "true", "yes")


def main():
    second_look = is_second_look()
    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    legacy_api_key = os.environ.get("RAPIDAPI_KEY", "").strip()
    beat_key = os.environ.get("BEAT_ANALYTICS_RAPIDAPI_KEY", "").strip() or legacy_api_key
    music_key = os.environ.get("MUSIC_METRICS_RAPIDAPI_KEY", "").strip() or legacy_api_key
    music_analytics_key = os.environ.get("MUSIC_ANALYTICS_RAPIDAPI_KEY", "").strip() or legacy_api_key
    checkleakedcc_key = os.environ.get("CHECKLEAKEDCC_RAPIDAPI_KEY", "").strip() or legacy_api_key

    if not supabase_url or not service_key:
        print("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
        sys.exit(1)
    if not beat_key and not music_key and not music_analytics_key and not checkleakedcc_key:
        print("No stream lookup provider key is set. Skipping stale-fix.")
        sys.exit(0)

    pg = Postgrest(supabase_url, service_key)

    try:
        settings_rows = pg.select(
            "user_settings",
            "rapidapi_auto_fix_enabled",
            "rapidapi_auto_fix_enabled=eq.false&limit=1",
        )
        if settings_rows:
            print("Stream lookup auto-fix is disabled in settings. Skipping.")
            write_summary("", 0, 0, [], status="disabled")
            sys.exit(0)
    except Exception as e:
        print(f"Warning: could not read auto-fix settings ({e}). Using defaults.")

    print(
        f"Auto-fix ceiling: fewer than {MAX_AUTO_FIX_TRACKS} stale track(s); free providers only "
        f"(Beat Analytics {BEAT_ANALYTICS_DAILY_CAP}/day + "
        f"Music Metrics {MUSIC_METRICS_DAILY_CAP}/day + "
        f"MusicAnalytics {MUSIC_ANALYTICS_MONTHLY_CAP}/month + "
        f"CheckLeakedCC {CHECKLEAKEDCC_MONTHLY_CAP}/month)"
    )

    run_date = datetime.now(timezone.utc).date().isoformat()
    warnings = pg.select(
        "ingestion_warnings",
        "run_date,details_json",
        f"code=eq.individual_tracks_stale&run_date=eq.{run_date}&limit=1",
    )
    if not warnings:
        print(f"No individual_tracks_stale warning found for run_date={run_date}. Nothing to do.")
        sys.exit(0)

    warning = warnings[0]
    details = warning.get("details_json") or {}
    affected_tracks: List[dict] = details.get("affected_tracks", [])

    if not run_date or not affected_tracks:
        print(f"Warning found for {run_date} but no affected tracks. Nothing to do.")
        sys.exit(0)

    print(f"Found {len(affected_tracks)} stale track(s) for run_date={run_date}")

    if len(affected_tracks) >= MAX_AUTO_FIX_TRACKS:
        print(
            f"Stale warning reached the auto-fix safety threshold "
            f"({len(affected_tracks)} >= {MAX_AUTO_FIX_TRACKS}). Skipping auto-fix."
        )
        write_summary(run_date, 0, 0, [], status="skipped_too_many", affected_count=len(affected_tracks))
        sys.exit(0)

    existing = pg.select(
        "track_daily_stream_overrides",
        "isrc,note",
        f"date=eq.{run_date}&note=like.{OVERRIDE_NOTE_PREFIX}*auto*",
    )
    existing_isrcs = {str(r.get("isrc", "")).strip().upper() for r in existing}
    # Manual, interpolation and artist.tools overrides always win: never touch a date/ISRC that has any override.
    try:
        all_overrides = pg.select("track_daily_stream_overrides", "isrc,note", f"date=eq.{run_date}")
    except Exception as e:
        print(f"Warning: could not load all of today's overrides ({e}). Falling back to stale-fix overrides.")
        all_overrides = existing
    overridden_isrcs = {str(r.get("isrc", "")).strip().upper() for r in all_overrides} | existing_isrcs
    usage_date = datetime.now(timezone.utc).date().isoformat()
    usage = usage_for_period(pg, usage_date, existing)
    existing_music_analytics = usage["music_analytics"]
    existing_checkleakedcc = usage["checkleakedcc"]
    existing_beat = usage["beat_analytics"]
    existing_music = usage["music_metrics"]
    already_fixed = len(existing_isrcs)
    budget = max(0, len(affected_tracks) - already_fixed)
    beat_budget = max(0, min(BEAT_ANALYTICS_DAILY_CAP - existing_beat, budget))
    music_budget = max(0, min(MUSIC_METRICS_DAILY_CAP - existing_music, budget))
    music_analytics_budget = max(0, min(MUSIC_ANALYTICS_MONTHLY_CAP - existing_music_analytics, budget))
    checkleakedcc_budget = max(0, min(CHECKLEAKEDCC_MONTHLY_CAP - existing_checkleakedcc, budget))

    print(f"  Already fixed today: {already_fixed} | Remaining stale tracks: {budget}")
    print(
        f"  Provider budget: Beat Analytics={beat_budget}, "
        f"Music Metrics={music_budget}, MusicAnalytics={music_analytics_budget}, "
        f"CheckLeakedCC={checkleakedcc_budget}"
    )

    if budget <= 0:
        print("No stale tracks remain eligible for auto-fix. Exiting.")
        write_summary(run_date, 0, 0, [], status="nothing_to_do", affected_count=len(affected_tracks))
        sys.exit(0)

    candidates = []
    for t in affected_tracks:
        isrc = str(t.get("isrc", "")).strip().upper()
        streams = int(t.get("streams_cumulative", 0))
        if not isrc or isrc in overridden_isrcs:
            continue
        candidates.append({"isrc": isrc, "stale_streams": streams})
    candidates = attach_spotify_track_ids(pg, candidates[:budget])

    history = load_effective_history(pg, run_date, [c["isrc"] for c in candidates]) if candidates else {}
    if second_look and candidates:
        # Re-check only tracks that are still stale now: today's effective value is not above yesterday's.
        still_stale = []
        for c in candidates:
            prev_value, _, _ = sc.history_stats(history.get(c["isrc"], []), date.fromisoformat(run_date))
            today_value = next(
                (v for d, v in history.get(c["isrc"], []) if d == date.fromisoformat(run_date)), None
            )
            if today_value is not None:
                c["stale_streams"] = today_value
            if today_value is not None and prev_value is not None and today_value > prev_value:
                continue
            still_stale.append(c)
        print(f"  Second look: {len(still_stale)} of {len(candidates)} candidate(s) still stale.")
        candidates = still_stale

    if not candidates:
        print("All stale tracks already fixed or none eligible. Nothing to do.")
        write_summary(
            run_date, 0, 0, [], status="nothing_to_do", affected_count=len(affected_tracks), second_look=second_look
        )
        sys.exit(0)

    artist_tools_obs = load_artist_tools_observations(pg, run_date, [c["isrc"] for c in candidates])
    print(f"  Fetching stream counts for {len(candidates)} track(s)...")

    started_at = time.monotonic()
    fixed: List[dict] = []
    pending_overrides: List[dict] = []
    attempted = 0
    stopped_early = False
    reject_log: List[dict] = []
    source_stats = {
        name: {"attempts": 0, "rejects": 0}
        for name in ("Beat Analytics", "Music Metrics", "MusicAnalytics", "CheckLeakedCC", ARTIST_TOOLS_SOURCE)
    }
    # (display name, usage key, key present, needs Spotify id, budget). Fetchers are resolved at call time.
    providers = [
        ("Beat Analytics", "beat_analytics", bool(beat_key), True, beat_budget,
         lambda c: fetch_beat_analytics_streams(c["spotify_track_id"], beat_key)),
        ("Music Metrics", "music_metrics", bool(music_key), False, music_budget,
         lambda c: fetch_music_metrics_streams(c["isrc"], music_key)),
        ("MusicAnalytics", "music_analytics", bool(music_analytics_key), True, music_analytics_budget,
         lambda c: fetch_music_analytics_streams(c["spotify_track_id"], music_analytics_key)),
        ("CheckLeakedCC", "checkleakedcc", bool(checkleakedcc_key), True, checkleakedcc_budget,
         lambda c: fetch_checkleakedcc_streams(c["spotify_track_id"], c["isrc"], checkleakedcc_key)),
    ]
    provider_attempted = {name: 0 for name, *_ in providers}
    run_day = date.fromisoformat(run_date)

    for i, c in enumerate(candidates):
        if time.monotonic() - started_at >= MAX_RUNTIME_SECONDS:
            stopped_early = True
            print(
                f"  Reached graceful runtime ceiling after {attempted} attempt(s); "
                "stopping before the workflow timeout."
            )
            break

        isrc = c["isrc"]
        stale = c["stale_streams"]
        attempted += 1
        prev_value, avg_gain, flat_run = sc.history_stats(history.get(isrc, []), run_day)
        ctx = sc.Context(stale_value=stale, prev_value=prev_value, avg_daily_gain=avg_gain, flat_run=flat_run)
        candidates_seen: List[tuple] = []
        got_data = False

        def log_reject(rej: "sc.Reject"):
            source_stats.setdefault(rej.source, {"attempts": 0, "rejects": 0})["rejects"] += 1
            reject_log.append({"isrc": isrc, **rej.__dict__})
            print(
                f"    {isrc}: rejected {rej.source}={rej.value:,} ({rej.reason}; "
                f"stale={stale:,}, prev={prev_value if prev_value is None else format(prev_value, ',')}, "
                f"cap={rej.cap_value if rej.cap_value is None else format(rej.cap_value, ',')})"
            )

        # artist.tools observation already stored for today is one more candidate (no quota used).
        if isrc in artist_tools_obs:
            candidates_seen.append((ARTIST_TOOLS_SOURCE, artist_tools_obs[isrc]))

        # Providers in priority order; stop at the first plausible provider value, fall through on rejects.
        for name, usage_key, has_key, needs_spotify, prov_budget, fetch in providers:
            if not has_key or (needs_spotify and not c.get("spotify_track_id")):
                continue
            if provider_attempted[name] >= prov_budget:
                continue
            provider_attempted[name] += 1
            source_stats[name]["attempts"] += 1
            record_provider_call(pg, usage_date, usage_key, usage)
            try:
                value = fetch(c)
            except Exception as e:
                print(f"    {isrc}: {name} error - {e}")
                continue
            if value is None:
                continue
            got_data = True
            candidates_seen.append((name, value))
            if sc.check_candidate(name, value, ctx) is None:
                break

        decision = sc.consolidate(candidates_seen, ctx)
        for rej in decision.rejects:
            log_reject(rej)
        provider = decision.source
        api_val = decision.value

        if not decision.accepted:
            if not got_data and not decision.rejects:
                print(f"    {isrc}: no data from stream providers")
            else:
                print(f"    {isrc}: no plausible value, left unchanged")
        else:
            delta = api_val - stale
            print(f"    {isrc}: OK stale={stale:,} -> {provider}={api_val:,} (+{delta:,})")
            item = {
                "isrc": isrc,
                "streams": api_val,
                "stale": stale,
                "provider": provider,
                "note": sc.provenance_note(decision, second_look=second_look),
            }
            fixed.append(item)
            pending_overrides.append(item)
            if len(pending_overrides) >= OVERRIDE_FLUSH_BATCH_SIZE:
                flushed = flush_override_batch(pg, run_date, pending_overrides)
                print(f"  Persisted {flushed} override(s) mid-run.")

        if i < len(candidates) - 1:
            time.sleep(RATE_LIMIT_MS / 1000)

    flushed = flush_override_batch(pg, run_date, pending_overrides)
    if flushed:
        print(f"  Persisted final {flushed} override(s).")

    if fixed:
        print(f"\n  Wrote {len(fixed)} override(s). Triggering recompute...")

        pg.rpc("spotibase_recompute_playlist_daily_stats_cascade", {"p_start_date": run_date})
        print("  Recompute complete.")
        refresh_own_home_snapshots(pg, date.fromisoformat(run_date))
    else:
        print("\n  No overrides to write.")

    fixed = enrich_fixed_tracks(pg, fixed)
    print(f"\nDone. Attempted={attempted}, Fixed={len(fixed)}, Rejected={len(reject_log)}")
    record_source_quality(pg, run_date, source_stats, reject_log)
    write_summary(
        run_date,
        attempted,
        len(fixed),
        fixed,
        status="partial_runtime_limit" if stopped_early else "completed",
        affected_count=len(affected_tracks),
        second_look=second_look,
        rejected=len(reject_log),
    )


def write_summary(
    run_date: str,
    attempted: int,
    fixed_count: int,
    fixed: list,
    status: str = "completed",
    affected_count: int = 0,
    second_look: bool = False,
    rejected: int = 0,
):
    summary = {
        "status": status,
        "second_look": second_look,
        "rejected": rejected,
        "run_date": run_date,
        "affected": affected_count,
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
