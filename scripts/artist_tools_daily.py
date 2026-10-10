"""Record artist.tools own-catalog counts and repair stale tracks after RapidAPI."""
import argparse
from collections import Counter
from datetime import date, timedelta
import json
from pathlib import Path

from artist_tools_mcp import (ArtistToolsError, DailyLimit, LeaseBusy, MCPClient,
                              TokenManager, database_from_env, utcnow)

MAX_AUTO_FIX_TRACKS = 500  # Same exclusive ceiling as rapidapi_stale_fix.py
SUMMARY_PATH = Path(".artifacts/artist_tools_summary.json")


def isrc_of(row):
    return str(row.get("isrc") or "").strip().upper()


def affected(warning):
    return (warning.get("details_json") or {}).get("affected_tracks") or []


def priority_tracks(tracks, stale, warnings, saved):
    today = {isrc_of(row) for row in stale}
    counts = Counter(isrc_of(row) for warning in warnings for row in affected(warning))

    def key(track):
        isrc = isrc_of(track)
        latest = track.get("latest") or []
        streams = int(latest[0].get("streams_cumulative") or 0) if latest else 0
        tier = 0 if isrc in today else 1 if counts[isrc] else 2
        return tier, -counts[isrc] if tier == 1 else 0, -streams, isrc

    # Spotify IDs identify folder entries; ISRCs remain our stable catalog key.
    output, seen = [], set(saved)
    for track in sorted(tracks, key=key):
        spotify_id = track.get("spotify_track_id")
        if spotify_id and spotify_id not in seen:
            output.append(track)
            seen.add(spotify_id)
    return output


def folder_pages(client):
    for page in range(1, 101):
        payload = client.call_tool("list_dashboard_entities", {
            "entity_type": "track", "folder_name": "My Tracks", "limit": 100, "page": page,
        })
        result = payload.get("result", payload)
        items = result["items"]
        yield items
        if page * 100 >= int(result["totalCount"]):
            return
        if not items:
            raise ArtistToolsError("Folder pagination ended before totalCount was reached.")
    raise ArtistToolsError("My Tracks exceeds the MCP 100-page limit; observation is incomplete.")


def override_rows(run_date, stale, observations, previous, existing):
    if len(stale) >= MAX_AUTO_FIX_TRACKS:
        return []
    rows = []
    seen = set(existing)
    for track in stale:
        isrc = isrc_of(track)
        streams = observations.get(isrc)
        stale_value = track.get("streams_cumulative")
        prev = previous.get(isrc)
        if isrc in seen or streams is None or stale_value is None or prev is None:
            continue  # No previous-day anchor: fail closed.
        if streams > int(stale_value) and streams >= int(prev):
            rows.append({"date": run_date, "isrc": isrc, "streams_cumulative_override": streams,
                         "note": "stale-fix: artist.tools auto"})
            seen.add(isrc)
    return rows


def write_overrides(pg, rows):
    if not rows:
        return []
    # INSERT ON CONFLICT DO NOTHING also protects a RapidAPI/manual override
    # committed after our read. Merge-upsert would overwrite it in that race.
    response = pg._request(
        "POST", f"{pg.base}/track_daily_stream_overrides?on_conflict=date,isrc",
        {**pg.h, "Prefer": "resolution=ignore-duplicates,return=representation"},
        data=json.dumps(rows), idempotent=True,
    )
    if response.status_code not in (200, 201):
        raise ArtistToolsError("Could not write artist.tools overrides.")
    return response.json()


def is_done(pg, run_date):
    return bool(pg.select("artist_tools_runs", "run_date", f"run_date=eq.{run_date}&status=eq.success&limit=1"))


def execute(pg, client, run_date, max_adds, summary):
    today = pg.select("ingestion_warnings", "run_date,details_json",
                      f"code=eq.individual_tracks_stale&run_date=eq.{run_date}&order=id.desc&limit=1")
    stale = affected(today[0]) if today else []
    history_start = (date.fromisoformat(run_date) - timedelta(days=89)).isoformat()
    history = pg.select_all("ingestion_warnings", "run_date,details_json",
                            f"code=eq.individual_tracks_stale&run_date=gte.{history_start}&run_date=lte.{run_date}",
                            order="id.asc")
    # A per-track lateral limit reads its latest snapshot without downloading
    # catalog history. PostgREST applies embedded order/limit per parent row.
    tracks = pg.select_all("tracks", "isrc,name,spotify_track_id,latest:track_daily_streams(streams_cumulative)",
                           f"spotify_track_id=not.is.null&latest.order=date.desc&latest.limit=1&latest.date=lte.{run_date}",
                           order="isrc.asc")
    by_spotify = {track["spotify_track_id"]: track for track in tracks}
    saved_rows = pg.select_all("artist_tools_saved_tracks", "spotify_track_id", "", order="spotify_track_id.asc")
    saved = {row["spotify_track_id"] for row in saved_rows}
    summary["affected"] = len(stale)
    summary["safety_threshold_reached"] = len(stale) >= MAX_AUTO_FIX_TRACKS
    # Honor the existing own-catalog auto-fix setting for this fallback, while
    # continuing to record independent source observations.
    summary["auto_fix_disabled"] = bool(pg.select("user_settings", "rapidapi_auto_fix_enabled",
                                                "rapidapi_auto_fix_enabled=eq.false&limit=1"))

    # Bootstrap the ledger from the owner's existing folder before any adds.
    if not saved and max_adds > 0:
        for items in folder_pages(client):
            rows = [{"spotify_track_id": item["spotifyId"],
                     "isrc": isrc_of(by_spotify[item["spotifyId"]]) if item["spotifyId"] in by_spotify else None}
                    for item in items]
            pg.upsert("artist_tools_saved_tracks", rows, "spotify_track_id")
            saved.update(row["spotify_track_id"] for row in rows)
        summary["reconciled"] = len(saved)

    for track in priority_tracks(tracks, stale, history, saved)[:max_adds]:
        try:
            payload = client.call_tool("add_entity_to_folder", {
                "entity_type": "track", "folder_name": "My Tracks",
                "spotify_id": track["spotify_track_id"], "name": track.get("name") or isrc_of(track),
            })
        except DailyLimit:
            summary["add_daily_limited"] = True
            break
        result = payload.get("result", payload)
        if result.get("added") is not True:
            raise ArtistToolsError("artist.tools did not confirm the folder add.")
        pg.upsert("artist_tools_saved_tracks", [{"spotify_track_id": track["spotify_track_id"],
                                                "isrc": isrc_of(track)}], "spotify_track_id")
        saved.add(track["spotify_track_id"])
        summary["added"] += 1
    summary["remaining_unsaved"] = len(priority_tracks(tracks, stale, history, saved))

    try:
        for items in folder_pages(client):
            if utcnow().date().isoformat() != run_date:
                raise ArtistToolsError("UTC date changed during observation; rerun for the current date.")
            rows = []
            for item in items:
                track = by_spotify.get(item.get("spotifyId"))
                value = item.get("streams")
                if not track or value is None:
                    continue
                # Never coerce fractional/boolean counts into a valid observation.
                if isinstance(value, bool) or not str(value).isdigit():
                    raise ArtistToolsError("artist.tools returned an invalid stream count.")
                rows.append({"date": run_date, "spotify_track_id": item["spotifyId"],
                             "isrc": isrc_of(track), "streams": int(value), "observed_at": utcnow().isoformat()})
            pg.upsert("artist_tools_track_streams", rows, "date,spotify_track_id")
            summary["observed"] += len(rows)
    except DailyLimit:
        # Quota exhaustion is recorded, not an authentication/job failure.
        summary["observe_daily_limited"] = True
        summary["observation_incomplete"] = True

    if summary["auto_fix_disabled"]:
        return

    # Read persisted observations so retries can recover earlier partial pages.
    observed = pg.select_all("artist_tools_track_streams", "isrc,streams",
                             f"date=eq.{run_date}", order="spotify_track_id.asc")
    observations = {}
    for row in observed:
        isrc = isrc_of(row)
        # Multiple Spotify versions sharing an ISRC: avoid selecting the highest
        # version's unrelated count; repair from the catalog's mapped ID only.
        if isrc not in observations:
            observations[isrc] = int(row["streams"])
        elif observations[isrc] != int(row["streams"]):
            observations[isrc] = -1  # ambiguous versions fail the sanity rules
    previous_date = (date.fromisoformat(run_date) - timedelta(days=1)).isoformat()
    previous = {}
    eligible_isrcs = sorted({isrc_of(row) for row in stale if isrc_of(row)})
    for offset in range(0, len(eligible_isrcs), 100):
        ids = ",".join(eligible_isrcs[offset:offset + 100])
        previous.update({isrc_of(row): row["streams_cumulative"] for row in pg.select_all(
            "track_daily_streams_effective_public", "isrc,streams_cumulative",
            f"date=eq.{previous_date}&isrc=in.({ids})", order="isrc.asc")})
    existing = pg.select_all("track_daily_stream_overrides", "isrc,note", f"date=eq.{run_date}", order="isrc.asc")
    rows = override_rows(run_date, stale, observations, previous, {isrc_of(row) for row in existing})
    written = write_overrides(pg, rows)
    summary["fixed"] = len(written)
    # Re-run an interrupted cascade from a previous attempt, too. This RPC is
    # idempotent; one invocation per run, regardless of override count.
    if written or any(row.get("note") == "stale-fix: artist.tools auto" for row in existing):
        pg.rpc("spotibase_recompute_playlist_daily_stats_cascade", {"p_start_date": run_date})


def write_summary(summary):
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


def run(pg, run_date, runner="manual", max_adds=240, skip_if_done=False,
        token_factory=TokenManager, client_factory=MCPClient):
    summary = {"run_date": run_date, "runner": runner, "status": "running", "added": 0,
               "observed": 0, "fixed": 0, "remaining_unsaved": None, "rate_limited": False,
               "daily_limited": False, "add_daily_limited": False, "observe_daily_limited": False,
               "observation_incomplete": False, "error": None}
    started = utcnow().isoformat()
    client = None
    try:
        if skip_if_done and is_done(pg, run_date):
            summary.update(status="success", skipped=True)
            return 0
        with token_factory(pg) as tokens:
            # Recheck after acquiring the account lease: another runner may
            # have completed between our first read and this acquisition.
            if skip_if_done and is_done(pg, run_date):
                summary.update(status="success", skipped=True)
                return 0
            pg.upsert("artist_tools_runs", [{"run_date": run_date, "runner": runner, "status": "running",
                                            "started_at": started, "finished_at": None,
                                            "added_count": 0, "observed_count": 0, "fixed_count": 0,
                                            "details": {}}], "run_date")
            client = client_factory(tokens)
            try:
                tokens.access_token()  # Broken authorization fails even with an empty catalog.
                execute(pg, client, run_date, max_adds, summary)
                summary["status"] = "success"
            except Exception as exc:
                summary["status"] = "failed"
                summary["error"] = str(exc) if isinstance(exc, ArtistToolsError) else f"Job failed ({type(exc).__name__}); provider/database details withheld."
            finally:
                summary["rate_limited"] = client.rate_limited
                summary["daily_limited"] = client.daily_limited
                tokens.heartbeat()  # Never overwrite a successor's run row after losing the lease.
                pg.upsert("artist_tools_runs", [{"run_date": run_date, "runner": runner,
                    "status": summary["status"], "started_at": started, "finished_at": utcnow().isoformat(),
                    "added_count": summary["added"], "observed_count": summary["observed"],
                    "fixed_count": summary["fixed"], "details": dict(summary)}], "run_date")
        return 0 if summary["status"] == "success" else 1
    except LeaseBusy as exc:
        # Do not clobber the active runner's run row or credentials.
        summary.update(status="failed", error=str(exc), lease_busy=True)
        return 1
    except Exception as exc:
        summary.update(status="failed", error=str(exc) if isinstance(exc, ArtistToolsError)
                       else f"Job failed ({type(exc).__name__}); details withheld.")
        return 1
    finally:
        write_summary(summary)
        print(json.dumps(summary))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    job = sub.add_parser("run", help="Add, observe, and repair today's own catalog")
    job.add_argument("--date", type=date.fromisoformat, default=utcnow().date())
    job.add_argument("--runner", choices=("github", "pc", "manual"), default="manual")
    job.add_argument("--max-adds", type=int, default=240)
    job.add_argument("--skip-if-done", action="store_true")
    args = parser.parse_args(argv)
    if not 0 <= args.max_adds <= 250:
        parser.error("--max-adds must be between 0 and 250")
    # artist.tools exposes current counts, not date-addressable history. Never
    # mislabel today's count as an older/newer snapshot in a manual invocation.
    if args.date != utcnow().date():
        parser.error("--date must be UTC today: artist.tools only exposes current stream counts")
    try:
        pg = database_from_env()
    except ArtistToolsError as exc:
        write_summary({"status": "failed", "run_date": args.date.isoformat(), "error": str(exc),
                       "added": 0, "observed": 0, "fixed": 0, "remaining_unsaved": None,
                       "rate_limited": False, "daily_limited": False})
        print(str(exc))
        return 1
    return run(pg, args.date.isoformat(), args.runner, args.max_adds, args.skip_if_done)


if __name__ == "__main__":
    raise SystemExit(main())
