import argparse
import csv
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import requests

from streambase_revalidate import notify_web_revalidate
from streambase_postgrest import Postgrest

STREAM_PAYOUT_USD = 0.002

COMPETITOR_TABLES = {
    "tracks": "competitor.tracks",
    "track_daily_streams": "competitor.track_daily_streams",
    "playlist_memberships": "competitor.playlist_memberships",
    "playlist_daily_stats": "competitor.playlist_daily_stats",
}


@dataclass(frozen=True)
class Playlist:
    playlist_key: str
    display_name: str
    label_key: str
    is_catalog: bool
    playlist_type: Optional[str]
    dashboard_url: str
    min_rows: int = 0


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def ymd(d: date) -> Tuple[str, str, str]:
    return f"{d.year:04d}", f"{d.month:02d}", f"{d.day:02d}"


def norm_isrc(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").strip().upper())


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def count_csv_rows(path: Path) -> int:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        next(r, None)
        return sum(1 for _ in r)


def iter_csv_rows(path: Path) -> Iterable[dict]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def load_playlists_csv(path: str) -> List[Playlist]:
    out: List[Playlist] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"playlist_key", "display_name", "label_key", "dashboard_url"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"{path} must contain columns: {', '.join(sorted(required))}")
        for row in reader:
            key = (row.get("playlist_key") or "").strip()
            name = (row.get("display_name") or "").strip()
            label_key = (row.get("label_key") or "").strip()
            url = (row.get("dashboard_url") or "").strip()
            if not key or not name or not label_key or not url:
                continue
            min_rows_raw = (row.get("min_rows") or "").strip()
            try:
                min_rows = int(min_rows_raw) if min_rows_raw else 0
            except Exception:
                min_rows = 0
            out.append(
                Playlist(
                    playlist_key=key,
                    display_name=name,
                    label_key=label_key,
                    is_catalog=(row.get("is_catalog") or "").strip().lower() in {"1", "true", "yes", "y"},
                    playlist_type=(row.get("playlist_type") or "").strip() or None,
                    dashboard_url=url,
                    min_rows=max(0, min_rows),
                )
            )
    return out


def build_playlist_stats_row(
    *,
    run_date: str,
    playlist_key: str,
    streams_by_isrc: Dict[str, int],
    all_isrcs: Set[str],
    previous_total: int,
    source_run_id: int,
) -> dict:
    total = sum(int(v) for v in streams_by_isrc.values())
    daily = total - int(previous_total or 0)
    return {
        "date": run_date,
        "playlist_key": playlist_key,
        "track_count": len(all_isrcs),
        "total_streams_cumulative": total,
        "daily_streams_net": daily,
        "est_revenue_total": total * STREAM_PAYOUT_USD,
        "est_revenue_daily_net": daily * STREAM_PAYOUT_USD,
        "missing_streams_track_count": len(all_isrcs - set(streams_by_isrc)),
        "source_run_id": source_run_id,
    }


def insert_memberships_idempotent(pg: Postgrest, rows: List[dict]):
    """Insert active playlist membership rows, tolerating already-active rows.

    Competitor exports can be rerun after a previous attempt failed halfway.
    The table intentionally has a partial unique index that permits only one
    active (valid_to is null) row per playlist/isrc. A duplicate should mean
    "already active", not "the whole daily export is broken".
    """
    if not rows:
        return
    try:
        pg.insert("playlist_memberships", rows)
        return
    except RuntimeError as exc:
        if "23505" not in str(exc) and "duplicate key value" not in str(exc):
            raise

    # Fallback path for reruns/partial prior failures: retry row-by-row and
    # swallow only active-membership duplicate conflicts.
    for row in rows:
        try:
            pg.insert("playlist_memberships", [row])
        except RuntimeError as exc:
            msg = str(exc)
            if "competitor_playlist_memberships_active_uq" in msg or "duplicate key value" in msg:
                continue
            raise


def parse_stream_value(raw: object) -> Optional[int]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        return int(float(s.replace(",", "")))
    except Exception:
        return None


def parse_release_date(raw: object) -> Optional[str]:
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/competitor_playlists.csv")
    ap.add_argument("--exports-dir", default="exports")
    ap.add_argument("--run-date", default="")
    args = ap.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        raise SystemExit("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

    run_date = date.fromisoformat(args.run_date) if args.run_date else utc_today()
    prev_date = run_date - timedelta(days=1)
    y, m, d = ymd(run_date)
    day_dir = Path(args.exports_dir) / y / m / d
    if not day_dir.exists():
        raise SystemExit(f"Expected exports for {run_date} at {day_dir} (not found)")

    playlists = load_playlists_csv(args.config)
    pg = Postgrest(supabase_url, service_key, schema="competitor")

    existing = pg.select("ingestion_runs", "id,status", f"run_date=eq.{run_date.isoformat()}")
    if existing:
        run_id = int(existing[0]["id"])
        pg.patch(
            "ingestion_runs",
            {"status": "running", "started_at": datetime.now(timezone.utc).isoformat()},
            f"id=eq.{run_id}",
        )
    else:
        created = pg.insert(
            "ingestion_runs",
            [{"run_date": run_date.isoformat(), "status": "running"}],
        )
        run_id = int(created[0]["id"])

    all_track_rows: Dict[str, dict] = {}
    stats_rows: List[dict] = []

    for playlist in playlists:
        csv_path = day_dir / f"{playlist.playlist_key}.csv"
        if not csv_path.exists():
            pg.insert(
                "ingestion_warnings",
                [{
                    "run_id": run_id,
                    "run_date": run_date.isoformat(),
                    "playlist_key": playlist.playlist_key,
                    "severity": "critical",
                    "code": "missing_export",
                    "message": f"Missing export for {playlist.playlist_key}",
                }],
            )
            continue

        rows_count = count_csv_rows(csv_path)
        if playlist.min_rows and rows_count < playlist.min_rows:
            raise RuntimeError(
                f"Export row-count below configured minimum for {playlist.playlist_key}: {rows_count} < {playlist.min_rows}"
            )

        streams_by_isrc: Dict[str, int] = {}
        all_isrcs: Set[str] = set()
        for row in iter_csv_rows(csv_path):
            isrc = norm_isrc(row.get("isrc") or "")
            if not isrc:
                continue
            all_isrcs.add(isrc)
            all_track_rows[isrc] = {
                "isrc": isrc,
                "name": (row.get("name") or "").strip() or None,
                "release_date": parse_release_date(row.get("release_date")),
                "first_seen": run_date.isoformat(),
                "last_seen": run_date.isoformat(),
            }
            streams = parse_stream_value(row.get("spotify_streams_total"))
            if streams is None:
                continue
            streams_by_isrc[isrc] = streams

        pg.upsert("tracks", list(all_track_rows.values()), on_conflict="isrc")
        pg.upsert(
            "track_daily_streams",
            [
                {
                    "date": run_date.isoformat(),
                    "isrc": isrc,
                    "streams_cumulative": streams,
                    "est_revenue_total": streams * STREAM_PAYOUT_USD,
                    "source_run_id": run_id,
                }
                for isrc, streams in streams_by_isrc.items()
            ],
            on_conflict="date,isrc",
        )

        previous = pg.select(
            "playlist_daily_stats",
            "total_streams_cumulative",
            f"playlist_key=eq.{playlist.playlist_key}&date=eq.{prev_date.isoformat()}",
        )
        previous_total = int(previous[0]["total_streams_cumulative"]) if previous else 0
        stats_rows.append(
            build_playlist_stats_row(
                run_date=run_date.isoformat(),
                playlist_key=playlist.playlist_key,
                streams_by_isrc=streams_by_isrc,
                all_isrcs=all_isrcs,
                previous_total=previous_total,
                source_run_id=run_id,
            )
        )

        active_rows = pg.select_all(
            "playlist_memberships",
            "id,isrc",
            f"playlist_key=eq.{playlist.playlist_key}&valid_to=is.null",
            order="id.asc",
        )
        active_isrcs = {str(r["isrc"]) for r in active_rows}
        today_isrcs = all_isrcs
        new_isrcs = today_isrcs - active_isrcs
        removed_isrcs = active_isrcs - today_isrcs
        insert_memberships_idempotent(
            pg,
            [
                {
                    "playlist_key": playlist.playlist_key,
                    "isrc": isrc,
                    "valid_from": run_date.isoformat(),
                }
                for isrc in sorted(new_isrcs)
            ],
        )
        for row in active_rows:
            if str(row["isrc"]) in removed_isrcs:
                pg.patch(
                    "playlist_memberships",
                    {"valid_to": prev_date.isoformat()},
                    f"id=eq.{row['id']}",
                )

        pg.insert(
            "raw_exports",
            [{
                "run_id": run_id,
                "playlist_key": playlist.playlist_key,
                "object_key": str(csv_path).replace("\\", "/"),
                "rows_count": rows_count,
                "file_sha256": sha256_file(csv_path),
            }],
        )

    pg.upsert("playlist_daily_stats", stats_rows, on_conflict="date,playlist_key")
    try:
        refreshed = pg.rpc(
            "refresh_artist_daily_stats",
            {
                "p_start_date": run_date.isoformat(),
                "p_end_date": run_date.isoformat(),
            },
        )
        print(f"INFO Refreshed competitor.artist_daily_stats for {run_date}: {refreshed}")
    except Exception as artist_stats_err:
        print(f"WARN Could not refresh competitor.artist_daily_stats: {artist_stats_err}")
    pg.patch(
        "ingestion_runs",
        {"status": "success", "finished_at": datetime.now(timezone.utc).isoformat()},
        f"id=eq.{run_id}",
    )

    # Refresh the web app's cached analytics now that new data is live.
    notify_web_revalidate()


if __name__ == "__main__":
    main()
