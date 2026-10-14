"""Record artist.tools own-catalog counts and repair stale tracks after RapidAPI."""
import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import date, timedelta
import json
from pathlib import Path
import re
import time

from artist_tools_mcp import (ArtistToolsError, DailyLimit, LeaseBusy, LongRateLimit, MCPClient, RunBudgetExceeded,
                              TokenManager, database_from_env, utcnow)
from streambase_home_snapshots import refresh_own_home_snapshots

MAX_AUTO_FIX_TRACKS = 500  # Same exclusive ceiling as rapidapi_stale_fix.py
SUMMARY_PATH = Path(".artifacts/artist_tools_summary.json")
RUN_BUDGET_SECONDS = 75 * 60


class RunBudget:
    def __init__(self):
        self.deadline = time.monotonic() + RUN_BUDGET_SECONDS

    def check(self, seconds=0):
        if time.monotonic() + seconds >= self.deadline:
            raise RunBudgetExceeded()

    @contextmanager
    def database(self, pg):
        # Guard every PostgREST page/write without changing other pipelines.
        # Keep bounded DB retries, but reserve time for finalization/release.
        original = pg._request
        timeout = getattr(pg, "timeout_s", None)
        if timeout is not None:
            pg.timeout_s = min(timeout, 30)

        def request(*args, **kwargs):
            self.check()
            return original(*args, **kwargs)

        pg._request = request
        try:
            yield
        finally:
            pg._request = original
            if timeout is not None:
                pg.timeout_s = timeout


@contextmanager
def phase(summary, name):
    def log(event):
        print(f"[artist.tools] phase={name} event={event} added={summary['added']} "
              f"observed={summary['observed']} fixed={summary['fixed']} "
              f"budget_exhausted={str(summary['budget_exhausted']).lower()}", flush=True)
    log("start")
    try:
        yield
    finally:
        log("end")


def record_long_limit(summary, phase_name, exc):
    summary.update(rate_limited=True, retry_after_seconds=exc.seconds)
    summary[f"{phase_name}_rate_limited"] = True


def add_response_shape(result, depth=0):
    """Retain field types, booleans and short enum codes, never entity values."""
    if not isinstance(result, dict):
        return {"type": type(result).__name__}
    shape = {}
    for index, (key, value) in enumerate(result.items()):
        safe_key = key if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,39}", key) else f"redacted_key_{index}"
        field = {"type": type(value).__name__}
        normalized = re.sub(r"[^a-z]", "", safe_key.lower())
        sensitive = any(part in normalized for part in ("id", "name", "token", "secret", "authorization"))
        if not sensitive and isinstance(value, bool):
            field["value"] = value
        elif (normalized in ("code", "errorcode", "status", "reason", "type")
              and isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z_-]{0,39}", value)):
            field["value"] = value
        elif isinstance(value, dict) and not sensitive and depth < 3:
            field["fields"] = add_response_shape(value, depth + 1)
        shape[safe_key] = field
    return shape


def add_response_outcome(shape):
    """Only explicit positive boolean/code signals establish presence or a cap."""
    signals = set()
    for key, field in shape.items():
        if not isinstance(field, dict):
            continue
        if "fields" in field:
            signals.add(add_response_outcome(field["fields"]))
        value = field.get("value")
        signal = key if value is True else value if isinstance(value, str) else ""
        words = re.sub(r"([a-z])([A-Z])", r"\1_\2", signal).lower().replace("-", "_").split("_")
        if any(word in ("no", "not", "missing") for word in words):
            continue
        normalized = "".join(words)
        if ("duplicate" in words or "exists" in words
                or "already" in words and any(word in words for word in ("present", "folder", "saved", "added", "existing"))
                or normalized in ("infolder", "ispresent", "isduplicate", "alreadyexists")):
            signals.add("present")
        if (any(word in words for word in ("limit", "limited", "cap", "capped", "quota"))
                or normalized in ("folderfull", "atcapacity", "capacityreached", "capacityexceeded")
                or "capacity" in words and any(word in words for word in ("reached", "exceeded", "full"))):
            signals.add("limit")
    # A cap takes precedence over conflicting presence hints: do not keep adding.
    return "limit" if "limit" in signals else "present" if "present" in signals else "unknown"


def merge_run_record(previous, current, retry=False):
    """Called under the account lease; retain evidence from earlier attempts."""
    if previous is None:
        return current
    merged = dict(current)
    for count in ("added_count", "observed_count", "fixed_count"):
        merged[count] = max(previous.get(count) or 0, current[count])
    details = dict(previous.get("details") or {})
    if retry:
        retries = list(details.get("retries") or [])
        retries.append({**current["details"], "started_at": current["started_at"],
                        "finished_at": current["finished_at"]})
        details["retries"] = retries[-5:]
    merged["details"] = details
    return merged


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


def folder_pages(client, check_budget=lambda: None):
    for page in range(1, 101):
        check_budget()
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


def write_overrides(pg, rows, check_budget=lambda: None, summary=None):
    if not rows:
        return []
    # Refresh each candidate immediately before the write; the warning is an
    # earlier snapshot and SOT may have re-ingested a larger value since then.
    written = []
    for row in rows:
        check_budget()
        current = pg.select("track_daily_streams_effective_public", "isrc,streams_cumulative",
                            f"date=eq.{row['date']}&isrc=eq.{row['isrc']}&limit=1")
        value = next((item.get("streams_cumulative") for item in current if isrc_of(item) == row["isrc"]), None)
        if value is None or row["streams_cumulative_override"] <= int(value):
            continue
        # One write directly after each read, rather than checking all tracks
        # before a later batch. Conflict-ignore still protects concurrent fixes.
        response = pg._request(
            "POST", f"{pg.base}/track_daily_stream_overrides?on_conflict=date,isrc",
            {**pg.h, "Prefer": "resolution=ignore-duplicates,return=representation"},
            data=json.dumps([row]), idempotent=True,
        )
        if response.status_code not in (200, 201):
            raise ArtistToolsError("Could not write artist.tools overrides.")
        written.extend(response.json())
        if summary is not None:
            summary["fixed"] = len(written)
    return written


def is_done(pg, run_date):
    return bool(pg.select("artist_tools_runs", "run_date", f"run_date=eq.{run_date}&status=eq.success&limit=1"))


def execute(pg, client, run_date, max_adds, summary, budget):
    budget.check()
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
    isrcs_by_spotify = defaultdict(set)
    for track in tracks:
        isrcs_by_spotify[track["spotify_track_id"]].add(isrc_of(track))
    ambiguous = {spotify_id: sorted(isrcs) for spotify_id, isrcs in isrcs_by_spotify.items() if len(isrcs) > 1}
    summary["ambiguous_spotify_ids"] = ambiguous
    by_spotify = {spotify_id: next(iter(isrcs)) if len(isrcs) == 1 else None
                  for spotify_id, isrcs in isrcs_by_spotify.items()}
    saved_rows = pg.select_all("artist_tools_saved_tracks", "spotify_track_id", "", order="spotify_track_id.asc")
    saved = {row["spotify_track_id"] for row in saved_rows}
    summary["affected"] = len(stale)
    summary["safety_threshold_reached"] = len(stale) >= MAX_AUTO_FIX_TRACKS
    # Honor the existing own-catalog auto-fix setting for this fallback, while
    # continuing to record independent source observations.
    summary["auto_fix_disabled"] = bool(pg.select("user_settings", "rapidapi_auto_fix_enabled",
                                                "rapidapi_auto_fix_enabled=eq.false&limit=1"))

    with phase(summary, "adds"):
        try:
            # Bootstrap the ledger from the owner's existing folder before any adds.
            if not saved and max_adds > 0:
                try:
                    for items in folder_pages(client, budget.check):
                        rows = [{"spotify_track_id": item["spotifyId"], "isrc": by_spotify.get(item["spotifyId"])}
                                for item in items]
                        pg.upsert("artist_tools_saved_tracks", rows, "spotify_track_id")
                        saved.update(row["spotify_track_id"] for row in rows)
                except DailyLimit:
                    summary.update(reconcile_daily_limited=True, observation_incomplete=True,
                                   remaining_unsaved=len(priority_tracks(tracks, stale, history, saved)))
                    return  # Preserve bootstrap behavior: the listing quota is exhausted.
                except LongRateLimit as exc:
                    record_long_limit(summary, "reconcile", exc)
                    summary.update(observation_incomplete=True,
                                   remaining_unsaved=len(priority_tracks(tracks, stale, history, saved)))
                    return  # Observation uses the same rate-limited listing tool.
                summary["reconciled"] = len(saved)

            for track in priority_tracks(tracks, stale, history, saved)[:max_adds]:
                budget.check()
                try:
                    payload = client.call_tool("add_entity_to_folder", {
                        "entity_type": "track", "folder_name": "My Tracks",
                        "spotify_id": track["spotify_track_id"], "name": track.get("name") or isrc_of(track),
                    })
                except LongRateLimit as exc:
                    record_long_limit(summary, "add", exc)
                    break
                except DailyLimit:
                    summary["add_daily_limited"] = True
                    break
                result = payload.get("result", payload) if isinstance(payload, dict) else payload
                confirmed = isinstance(result, dict) and result.get("added") is True
                if not confirmed:
                    shape = add_response_shape(result)
                    summary["add_unconfirmed_shape"] = shape
                    print(f"[artist.tools] event=add_unconfirmed shape={json.dumps(shape)}", flush=True)
                    outcome = add_response_outcome(shape)
                    if outcome == "limit":
                        summary["add_limit_reached"] = True
                        break
                    if outcome != "present":
                        summary.update(adds_incomplete=True, add_unconfirmed=True)
                        break
                pg.upsert("artist_tools_saved_tracks", [{"spotify_track_id": track["spotify_track_id"],
                                                        "isrc": by_spotify[track["spotify_track_id"]]}], "spotify_track_id")
                saved.add(track["spotify_track_id"])
                if confirmed:
                    summary["added"] += 1

        except RunBudgetExceeded:
            summary.update(budget_exhausted=True, adds_incomplete=True)
    summary["remaining_unsaved"] = len(priority_tracks(tracks, stale, history, saved))

    with phase(summary, "observation"):
        try:
            try:
                for items in folder_pages(client, budget.check):
                    if utcnow().date().isoformat() != run_date:
                        raise ArtistToolsError("UTC date changed during observation; rerun for the current date.")
                    rows = []
                    for item in items:
                        spotify_id = item.get("spotifyId")
                        value = item.get("streams")
                        if spotify_id not in by_spotify or value is None:
                            continue
                        # Never coerce fractional/boolean counts into a valid observation.
                        if isinstance(value, bool) or not str(value).isdigit():
                            raise ArtistToolsError("artist.tools returned an invalid stream count.")
                        rows.append({"date": run_date, "spotify_track_id": item["spotifyId"],
                                     "isrc": by_spotify[spotify_id], "streams": int(value), "observed_at": utcnow().isoformat()})
                    pg.upsert("artist_tools_track_streams", rows, "date,spotify_track_id")
                    summary["observed"] += len(rows)
            except DailyLimit:
                # Quota exhaustion is recorded, not an authentication/job failure.
                summary["observe_daily_limited"] = True
                summary["observation_incomplete"] = True

            except LongRateLimit as exc:
                record_long_limit(summary, "observe", exc)
                summary["observation_incomplete"] = True
        except RunBudgetExceeded:
            summary.update(budget_exhausted=True, observation_incomplete=True)
    with phase(summary, "repair"):
        try:
            budget.check()
            if summary["auto_fix_disabled"]:
                return

            # Read persisted observations so retries can recover earlier partial pages.
            observed = pg.select_all("artist_tools_track_streams", "spotify_track_id,isrc,streams",
                                     f"date=eq.{run_date}", order="spotify_track_id.asc")
            observations = {}
            for row in observed:
                if row["spotify_track_id"] in ambiguous:
                    continue  # Includes observations persisted before this mapping became ambiguous.
                isrc = isrc_of(row)
                if not isrc:
                    continue
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
                budget.check()
                ids = ",".join(eligible_isrcs[offset:offset + 100])
                previous.update({isrc_of(row): row["streams_cumulative"] for row in pg.select_all(
                    "track_daily_streams_effective_public", "isrc,streams_cumulative",
                    f"date=eq.{previous_date}&isrc=in.({ids})", order="isrc.asc")})
            existing = pg.select_all("track_daily_stream_overrides", "isrc,note", f"date=eq.{run_date}", order="isrc.asc")
            rows = override_rows(run_date, stale, observations, previous, {isrc_of(row) for row in existing})
            written = write_overrides(pg, rows, budget.check, summary)
            summary["fixed"] = len(written)
            # Re-run an interrupted cascade from a previous attempt, too. This RPC is
            # idempotent; one invocation per run, regardless of override count.
            if written or any(row.get("note") == "stale-fix: artist.tools auto" for row in existing):
                budget.check()
                pg.rpc("spotibase_recompute_playlist_daily_stats_cascade", {"p_start_date": run_date})
                return True  # Refresh diagnostics once the provider lease is released.
        except RunBudgetExceeded:
            summary.update(budget_exhausted=True, repair_incomplete=True)


def write_summary(summary):
    SUMMARY_PATH.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


def run(pg, run_date, runner="manual", max_adds=240, skip_if_done=False,
        token_factory=TokenManager, client_factory=MCPClient):
    summary = {"run_date": run_date, "runner": runner, "status": "running", "added": 0,
               "observed": 0, "fixed": 0, "remaining_unsaved": None, "rate_limited": False,
               "daily_limited": False, "add_daily_limited": False, "observe_daily_limited": False,
               "reconcile_daily_limited": False, "observation_incomplete": False, "error": None,
               "add_rate_limited": False, "observe_rate_limited": False, "reconcile_rate_limited": False,
               "retry_after_seconds": None, "budget_exhausted": False, "adds_incomplete": False,
               "repair_incomplete": False, "add_limit_reached": False, "add_unconfirmed": False}
    budget = RunBudget()
    original_timeout = getattr(pg, "timeout_s", None)
    if original_timeout is not None:
        pg.timeout_s = min(original_timeout, 30)
    started = utcnow().isoformat()
    client = None
    refresh_snapshots = False
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
            previous_rows = pg.select("artist_tools_runs", "added_count,observed_count,fixed_count,details",
                                      f"run_date=eq.{run_date}&limit=1")
            previous = dict(previous_rows[0]) if previous_rows else None
            pg.upsert("artist_tools_runs", [merge_run_record(previous, {"run_date": run_date, "runner": runner, "status": "running",
                                            "started_at": started, "finished_at": None,
                                            "added_count": 0, "observed_count": 0, "fixed_count": 0,
                                            "details": {}})], "run_date")
            client = client_factory(tokens)
            try:
                client.check_budget = budget.check
                tokens.check_budget = budget.check
                with budget.database(pg):
                    budget.check()
                    tokens.access_token()  # Broken authorization fails even with an empty catalog.
                    refresh_snapshots = bool(execute(pg, client, run_date, max_adds, summary, budget))
                summary["status"] = "success"
            except RunBudgetExceeded:
                summary.update(status="success", budget_exhausted=True, adds_incomplete=True,
                               observation_incomplete=True, repair_incomplete=True)
            except Exception as exc:
                summary["status"] = "failed"
                summary["error"] = str(exc) if isinstance(exc, ArtistToolsError) else f"Job failed ({type(exc).__name__}); provider/database details withheld."
            finally:
                tokens.check_budget = None  # Finalization/release use the reserved cleanup time.
                client.check_budget = None
                summary["rate_limited"] = summary["rate_limited"] or client.rate_limited
                summary["daily_limited"] = client.daily_limited
                tokens.heartbeat()  # Never overwrite a successor's run row after losing the lease.
                pg.upsert("artist_tools_runs", [merge_run_record(previous, {"run_date": run_date, "runner": runner,
                    "status": summary["status"], "started_at": started, "finished_at": utcnow().isoformat(),
                    "added_count": summary["added"], "observed_count": summary["observed"],
                    "fixed_count": summary["fixed"], "details": dict(summary)}, retry=True)], "run_date")
        # Database retries can exceed the OAuth lease duration; snapshots are
        # best effort and must not make a completed provider job lose its lease.
        if refresh_snapshots and summary["status"] == "success" and not summary["budget_exhausted"]:
            try:
                with budget.database(pg):
                    budget.check()
                    refresh_own_home_snapshots(pg, date.fromisoformat(run_date))
            except RunBudgetExceeded:
                pass  # The provider run is already finalized; diagnostics are best effort.
        return 0 if summary["status"] == "success" else 1
    except LeaseBusy as exc:
        # Do not clobber the active runner's run row or credentials.
        summary.update(status="failed", error=str(exc), lease_busy=True)
        return 1
    except Exception as exc:
        error = str(exc) if isinstance(exc, ArtistToolsError) else f"Job failed ({type(exc).__name__}); details withheld."
        # A failed run-row write must not hide the token-recovery instructions
        # when the same database outage also prevented token persistence.
        summary.update(status="failed", error=f"{summary['error']} Finalization failed: {error}"
                       if summary["error"] else error)
        return 1
    finally:
        if original_timeout is not None:
            pg.timeout_s = original_timeout
        write_summary(summary)
        print(json.dumps(summary), flush=True)


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
