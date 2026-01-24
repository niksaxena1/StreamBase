import argparse
import csv
import hashlib
import json
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import requests


STREAM_PAYOUT_USD = 0.002


@dataclass(frozen=True)
class Playlist:
    playlist_key: str
    display_name: str
    is_catalog: bool
    dashboard_url: str


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def ymd(d: date) -> Tuple[str, str, str]:
    return f"{d.year:04d}", f"{d.month:02d}", f"{d.day:02d}"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def count_csv_rows(path: Path) -> int:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        try:
            next(r)
        except StopIteration:
            return 0
        return sum(1 for _ in r)


def load_playlists_csv(path: str) -> List[Playlist]:
    out: List[Playlist] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"playlist_key", "display_name", "is_catalog", "dashboard_url"}
        if not required.issubset(set(reader.fieldnames or [])):
            raise ValueError(f"{path} must contain columns: {', '.join(sorted(required))}")

        for row in reader:
            key = (row.get("playlist_key") or "").strip()
            name = (row.get("display_name") or "").strip()
            url = (row.get("dashboard_url") or "").strip()
            is_catalog = (row.get("is_catalog") or "").strip().lower() in ("1", "true", "yes", "y")
            if key and name:
                out.append(Playlist(playlist_key=key, display_name=name, is_catalog=is_catalog, dashboard_url=url))
    return out


def iter_csv_rows(path: Path) -> Iterable[dict]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row


def norm_isrc(s: str) -> str:
    return (s or "").strip().upper()


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
        }

    def upsert(self, table: str, rows: List[dict], on_conflict: str):
        if not rows:
            return
        url = f"{self.base}/{table}?on_conflict={on_conflict}"
        headers = dict(self.h)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        r = requests.post(url, headers=headers, data=json.dumps(rows), timeout=120)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Upsert {table} failed: {r.status_code} {r.text[:500]}")

    def insert(self, table: str, rows: List[dict]):
        if not rows:
            return
        url = f"{self.base}/{table}"
        headers = dict(self.h)
        headers["Prefer"] = "return=representation"
        r = requests.post(url, headers=headers, data=json.dumps(rows), timeout=120)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Insert {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def patch(self, table: str, patch_obj: dict, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        r = requests.patch(url, headers=headers, data=json.dumps(patch_obj), timeout=120)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Patch {table} failed: {r.status_code} {r.text[:500]}")

    def select(self, table: str, select: str, filters: str) -> List[dict]:
        url = f"{self.base}/{table}?select={select}&{filters}"
        r = requests.get(url, headers=self.h, timeout=120)
        if r.status_code != 200:
            raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()


def calc_rev(streams: Optional[int]) -> Optional[float]:
    if streams is None:
        return None
    return float(streams) * STREAM_PAYOUT_USD


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/playlists.csv")
    ap.add_argument("--exports-dir", default="exports", help="Local exports dir (default: exports)")
    ap.add_argument("--run-date", default="", help="Override run date (YYYY-MM-DD). Default: today UTC")
    args = ap.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    storage_bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "").strip() or "spotibase-exports"
    storage_prefix = os.environ.get("SUPABASE_STORAGE_PREFIX", "").strip() or "exports"

    if not supabase_url or not service_key:
        raise SystemExit("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

    run_date = utc_today()
    if args.run_date:
        run_date = date.fromisoformat(args.run_date)
    prev_date = run_date - timedelta(days=1)

    playlists = load_playlists_csv(args.config)
    exports_root = Path(args.exports_dir)
    y, m, d = ymd(run_date)
    day_dir = exports_root / y / m / d
    if not day_dir.exists():
        raise SystemExit(f"Expected exports for {run_date} at {day_dir} (not found)")

    pg = Postgrest(supabase_url=supabase_url, service_role_key=service_key)

    # Upsert playlists config
    pg.upsert(
        "playlists",
        [
            {
                "playlist_key": p.playlist_key,
                "display_name": p.display_name,
                "is_catalog": p.is_catalog,
                "dashboard_url": p.dashboard_url,
            }
            for p in playlists
        ],
        on_conflict="playlist_key",
    )

    # Create or fetch ingestion_run
    gha_sha = os.environ.get("GITHUB_SHA", "")
    gha_repo = os.environ.get("GITHUB_REPOSITORY", "")
    gha_run_id = os.environ.get("GITHUB_RUN_ID", "")
    logs_url = ""
    if gha_repo and gha_run_id:
        logs_url = f"https://github.com/{gha_repo}/actions/runs/{gha_run_id}"

    existing = pg.select("ingestion_runs", "id,status", f"run_date=eq.{run_date.isoformat()}")
    if existing:
        run_id = existing[0]["id"]
        pg.patch("ingestion_runs", {"status": "running", "started_at": datetime.now(timezone.utc).isoformat()}, f"id=eq.{run_id}")
    else:
        created = pg.insert(
            "ingestion_runs",
            [
                {
                    "run_date": run_date.isoformat(),
                    "status": "running",
                    "commit_sha": gha_sha or None,
                    "logs_url": logs_url or None,
                    "exports_prefix": f"{storage_prefix}/{y}/{m}/{d}",
                }
            ],
        )
        run_id = created[0]["id"]

    # Load today's exports into memory
    playlist_to_isrcs: Dict[str, Set[str]] = {}
    catalog_streams_today: Dict[str, int] = {}
    track_meta: Dict[str, dict] = {}
    raw_export_rows: List[dict] = []

    playlist_lookup = {p.playlist_key: p for p in playlists}
    for pl_key in playlist_lookup.keys():
        csv_path = day_dir / f"{pl_key}.csv"
        if not csv_path.exists():
            # Record warning + skip this playlist's updates
            pg.insert(
                "ingestion_warnings",
                [
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "critical",
                        "code": "missing_export",
                        "message": f"Missing export file for playlist_key={pl_key}",
                        "details_json": {"expected_path": str(csv_path)},
                    }
                ],
            )
            continue

        rows_count = count_csv_rows(csv_path)
        file_hash = sha256_file(csv_path)
        object_key = f"{storage_prefix}/{y}/{m}/{d}/{pl_key}.csv"

        raw_export_rows.append(
            {
                "run_id": run_id,
                "playlist_key": pl_key,
                "storage_bucket": storage_bucket,
                "storage_prefix": storage_prefix,
                "object_key": object_key,
                "rows_count": rows_count,
                "file_sha256": file_hash,
                "exported_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        if rows_count == 0:
            # Safety: do not modify membership for 0-row export
            pg.insert(
                "ingestion_warnings",
                [
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "critical",
                        "code": "zero_row_export",
                        "message": f"Export has 0 rows after retries; skipping membership updates for {pl_key}",
                        "details_json": {"object_key": object_key},
                    }
                ],
            )
            continue

        isrcs: Set[str] = set()
        is_catalog = playlist_lookup[pl_key].is_catalog
        for row in iter_csv_rows(csv_path):
            isrc = norm_isrc(row.get("isrc") or "")
            if not isrc:
                continue
            isrcs.add(isrc)

            # Track metadata
            name = (row.get("name") or "").strip() or None
            release_date_str = (row.get("release_date") or "").strip()
            release_date = None
            try:
                if release_date_str:
                    release_date = date.fromisoformat(release_date_str).isoformat()
            except Exception:
                release_date = None

            track_meta.setdefault(
                isrc,
                {
                    "isrc": isrc,
                    "name": name,
                    "release_date": release_date,
                    "first_seen": run_date.isoformat(),
                    "last_seen": run_date.isoformat(),
                },
            )

            # Catalog snapshot
            if is_catalog:
                s = (row.get("spotify_streams_total") or "").strip()
                try:
                    streams_total = int(float(s)) if s else 0
                except Exception:
                    streams_total = 0
                catalog_streams_today[isrc] = max(catalog_streams_today.get(isrc, 0), streams_total)

        playlist_to_isrcs[pl_key] = isrcs

    # Upsert raw_exports (one per playlist)
    pg.upsert("raw_exports", raw_export_rows, on_conflict="run_id,playlist_key")

    # Upsert tracks (lightweight metadata + first/last seen)
    # For first_seen, keep minimum; for last_seen, keep maximum (we'll patch after insert)
    pg.upsert("tracks", list(track_meta.values()), on_conflict="isrc")

    # Upsert today's catalog snapshots
    snapshot_rows = [
        {
            "date": run_date.isoformat(),
            "isrc": isrc,
            "streams_cumulative": streams,
            "source_run_id": run_id,
        }
        for isrc, streams in catalog_streams_today.items()
    ]
    pg.upsert("track_daily_streams", snapshot_rows, on_conflict="date,isrc")

    # Membership updates (skip playlists without parsed isrc set)
    for pl_key, todays_isrcs in playlist_to_isrcs.items():
        if not todays_isrcs:
            continue

        # Active on previous day (for LFL + net later); also active today for interval closure/opening
        active_today_rows = pg.select(
            "playlist_memberships",
            "id,isrc",
            f"playlist_key=eq.{pl_key}&valid_to=is.null",
        )
        active_today = {r["isrc"] for r in active_today_rows}
        active_id_by_isrc = {r["isrc"]: r["id"] for r in active_today_rows}

        to_add = sorted(todays_isrcs - active_today)
        to_remove = sorted(active_today - todays_isrcs)

        # Additions -> new interval
        if to_add:
            pg.insert(
                "playlist_memberships",
                [{"playlist_key": pl_key, "isrc": isrc, "valid_from": run_date.isoformat()} for isrc in to_add],
            )

        # Removals -> close interval at prev_date (so it's not active on run_date)
        for isrc in to_remove:
            row_id = active_id_by_isrc.get(isrc)
            if not row_id:
                continue
            pg.patch("playlist_memberships", {"valid_to": prev_date.isoformat()}, f"id=eq.{row_id}&valid_to=is.null")

    # Compute stats for each playlist (best-effort)
    # Pull yesterday totals for net calculation
    stats_rows: List[dict] = []
    for pl in playlists:
        pl_key = pl.playlist_key
        todays_isrcs = playlist_to_isrcs.get(pl_key)
        if not todays_isrcs:
            continue

        total = 0
        missing = 0
        for isrc in todays_isrcs:
            if isrc in catalog_streams_today:
                total += int(catalog_streams_today[isrc])
            else:
                missing += 1

        prev_stats = pg.select(
            "playlist_daily_stats",
            "total_streams_cumulative",
            f"playlist_key=eq.{pl_key}&date=eq.{prev_date.isoformat()}&limit=1",
        )
        prev_total = None
        if prev_stats and prev_stats[0].get("total_streams_cumulative") is not None:
            prev_total = int(prev_stats[0]["total_streams_cumulative"])

        daily_net = (total - prev_total) if prev_total is not None else None

        # LFL: continuing members between run_date and prev_date, only if we can find yesterday snapshots.
        yesterday_members = pg.select(
            "playlist_memberships",
            "isrc",
            f"playlist_key=eq.{pl_key}&valid_from=lte.{prev_date.isoformat()}&or=(valid_to.is.null,valid_to.gte.{prev_date.isoformat()})",
        )
        yesterday_set = {r["isrc"] for r in yesterday_members}
        continuing = todays_isrcs & yesterday_set

        # Pull yesterday streams for continuing set
        daily_lfl = None
        if continuing:
            # chunked query to avoid very long URLs
            cont_list = sorted(continuing)
            deltas = 0
            have_any = False
            for i in range(0, len(cont_list), 200):
                chunk = cont_list[i : i + 200]
                # in.(...) needs commas
                in_list = ",".join(chunk)
                y_rows = pg.select(
                    "track_daily_streams",
                    "isrc,streams_cumulative",
                    f"date=eq.{prev_date.isoformat()}&isrc=in.({in_list})",
                )
                y_map = {r["isrc"]: int(r["streams_cumulative"]) for r in y_rows}
                for isrc in chunk:
                    if isrc in catalog_streams_today and isrc in y_map:
                        deltas += int(catalog_streams_today[isrc]) - int(y_map[isrc])
                        have_any = True
            if have_any:
                daily_lfl = deltas

        stats_rows.append(
            {
                "date": run_date.isoformat(),
                "playlist_key": pl_key,
                "track_count": len(todays_isrcs),
                "total_streams_cumulative": total,
                "daily_streams_net": daily_net,
                "daily_streams_lfl": daily_lfl,
                "est_revenue_total": calc_rev(total),
                "est_revenue_daily_net": calc_rev(daily_net) if daily_net is not None else None,
                "est_revenue_daily_lfl": calc_rev(daily_lfl) if daily_lfl is not None else None,
                "missing_streams_track_count": missing,
                "source_run_id": run_id,
            }
        )

    pg.upsert("playlist_daily_stats", stats_rows, on_conflict="date,playlist_key")

    # Mark run success
    pg.patch(
        "ingestion_runs",
        {"status": "success", "finished_at": datetime.now(timezone.utc).isoformat()},
        f"id=eq.{run_id}",
    )

    print(f"✅ Ingestion complete for {run_date} (run_id={run_id})")


if __name__ == "__main__":
    main()
