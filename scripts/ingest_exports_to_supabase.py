import argparse
import csv
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import requests

STREAM_PAYOUT_USD = 0.002

# Warning thresholds (tune later)
TRACK_COUNT_SWING_WARN_RATIO = 0.30  # 30% day-over-day swing
ZERO_STREAM_WARN_RATIO = 0.60  # 60% rows with 0 cumulative streams (catalog exports only)


@dataclass(frozen=True)
class Playlist:
    playlist_key: str
    display_name: str
    is_catalog: bool
    playlist_type: Optional[str]
    dashboard_url: str
    min_rows: int = 0


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
            playlist_type = (row.get("playlist_type") or "").strip() or None
            min_rows_raw = (row.get("min_rows") or "").strip()
            try:
                min_rows = int(min_rows_raw) if min_rows_raw else 0
            except Exception:
                min_rows = 0
            if key and name:
                out.append(
                    Playlist(
                        playlist_key=key,
                        display_name=name,
                        is_catalog=is_catalog,
                        playlist_type=playlist_type,
                        dashboard_url=url,
                        min_rows=max(0, min_rows),
                    )
                )
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
        r = requests.post(url, headers=headers, data=json.dumps(rows), timeout=180)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"Upsert {table} failed: {r.status_code} {r.text[:500]}")

    def insert(self, table: str, rows: List[dict]):
        if not rows:
            return []
        url = f"{self.base}/{table}"
        headers = dict(self.h)
        headers["Prefer"] = "return=representation"
        r = requests.post(url, headers=headers, data=json.dumps(rows), timeout=180)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Insert {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def patch(self, table: str, patch_obj: dict, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        r = requests.patch(url, headers=headers, data=json.dumps(patch_obj), timeout=180)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Patch {table} failed: {r.status_code} {r.text[:500]}")

    def delete(self, table: str, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        r = requests.delete(url, headers=headers, timeout=180)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Delete {table} failed: {r.status_code} {r.text[:500]}")

    def select(self, table: str, select: str, filters: str) -> List[dict]:
        url = f"{self.base}/{table}?select={select}&{filters}"
        r = requests.get(url, headers=self.h, timeout=180)
        if r.status_code != 200:
            raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def select_all(self, table: str, select: str, filters: str, page_size: int = 1000) -> List[dict]:
        """
        Supabase PostgREST commonly enforces a max row limit (often 1000). Paginate with limit/offset.
        """
        out: List[dict] = []
        offset = 0
        while True:
            url = f"{self.base}/{table}?select={select}&{filters}&limit={page_size}&offset={offset}"
            r = requests.get(url, headers=self.h, timeout=180)
            if r.status_code != 200:
                raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
            batch = r.json()
            if not batch:
                break
            out.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size
        return out


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

    run_date = date.fromisoformat(args.run_date) if args.run_date else utc_today()
    prev_date = run_date - timedelta(days=1)

    playlists = load_playlists_csv(args.config)
    if not any(p.playlist_key == "all_catalog" for p in playlists):
        playlists.append(Playlist(playlist_key="all_catalog", display_name="All Catalog", is_catalog=True, playlist_type="Catalog", dashboard_url=""))

    exports_root = Path(args.exports_dir)
    y, m, d = ymd(run_date)
    day_dir = exports_root / y / m / d
    if not day_dir.exists():
        raise SystemExit(f"Expected exports for {run_date} at {day_dir} (not found)")

    pg = Postgrest(supabase_url=supabase_url, service_role_key=service_key)
    run_id: Optional[str] = None

    # Optional: load health warning exclusions (best-effort; table may not exist yet).
    # These exclusions are used to suppress "non_catalog_tracks_present" warnings and to
    # exclude those tracks from missing-streams counts.
    exclusion_code = "non_catalog_tracks_present"
    excluded_global: Set[str] = set()
    excluded_by_playlist: Dict[str, Set[str]] = {}

    def is_excluded(playlist_key: str, isrc: str) -> bool:
        if not isrc:
            return False
        if isrc in excluded_global:
            return True
        s = excluded_by_playlist.get(playlist_key)
        return bool(s and isrc in s)

    try:
        # --- playlists config ---
        pg.upsert(
            "playlists",
            [
                {
                    "playlist_key": p.playlist_key,
                    "display_name": p.display_name,
                    "is_catalog": p.is_catalog,
                    "playlist_type": p.playlist_type,
                    "dashboard_url": p.dashboard_url or None,
                }
                for p in playlists
            ],
            on_conflict="playlist_key",
        )

        try:
            rows = pg.select_all(
                "health_warning_exclusions",
                "playlist_key,isrc",
                f"code=eq.{exclusion_code}",
                page_size=1000,
            )
            for r in rows:
                isrc = norm_isrc(r.get("isrc") or "")
                if not isrc:
                    continue
                plk = (r.get("playlist_key") or "").strip()
                if plk:
                    excluded_by_playlist.setdefault(plk, set()).add(isrc)
                else:
                    excluded_global.add(isrc)
        except Exception:
            # Table might not exist or might be blocked; ignore and proceed without exclusions.
            pass

        # --- ingestion_runs ---
        gha_sha = os.environ.get("GITHUB_SHA", "")
        gha_repo = os.environ.get("GITHUB_REPOSITORY", "")
        gha_run_id = os.environ.get("GITHUB_RUN_ID", "")
        logs_url = f"https://github.com/{gha_repo}/actions/runs/{gha_run_id}" if gha_repo and gha_run_id else ""

        existing = pg.select("ingestion_runs", "id,status", f"run_date=eq.{run_date.isoformat()}")
        if existing:
            run_id = existing[0]["id"]
            pg.patch(
                "ingestion_runs",
                {
                    "status": "running",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "commit_sha": gha_sha or None,
                    "logs_url": logs_url or None,
                    "exports_prefix": f"{storage_prefix}/{y}/{m}/{d}",
                },
                f"id=eq.{run_id}",
            )
            # Clear stale warnings from previous attempts for the same run_id (re-run idempotency).
            pg.delete("ingestion_warnings", f"run_id=eq.{run_id}")
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

        # --- parse exports ---
        playlist_lookup = {p.playlist_key: p for p in playlists}
        export_keys = [k for k in playlist_lookup.keys() if k != "all_catalog"]

        playlist_to_isrcs: Dict[str, Set[str]] = {}
        catalog_streams_today: Dict[str, int] = {}
        track_meta: Dict[str, dict] = {}
        raw_export_rows: List[dict] = []
        catalog_zero_stream_ratio: Dict[str, float] = {}
        hard_fail_warnings: List[dict] = []

        for pl_key in export_keys:
            csv_path = day_dir / f"{pl_key}.csv"
            if not csv_path.exists():
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

            # Hard safety: minimum row count checks for key exports (configured in playlists.csv).
            pl_cfg = playlist_lookup.get(pl_key)
            if pl_cfg and pl_cfg.min_rows and rows_count < pl_cfg.min_rows:
                hard_fail_warnings.append(
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "critical",
                        "code": "min_rows_failed",
                        "message": f"Export row-count below configured minimum ({rows_count} < {pl_cfg.min_rows}); aborting ingestion to protect data integrity",
                        "details_json": {"rows_count": rows_count, "min_rows": pl_cfg.min_rows, "object_key": object_key},
                    }
                )

            if rows_count == 0:
                pg.insert(
                    "ingestion_warnings",
                    [
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": pl_key,
                            "severity": "critical",
                            "code": "zero_row_export",
                            "message": f"Export has 0 rows; skipping membership updates for {pl_key}",
                            "details_json": {"object_key": object_key},
                        }
                    ],
                )
                continue

            isrcs: Set[str] = set()
            is_catalog = playlist_lookup[pl_key].is_catalog
            zero_streams = 0
            seen_stream_rows = 0

            for row in iter_csv_rows(csv_path):
                isrc = norm_isrc(row.get("isrc") or "")
                if not isrc:
                    continue
                isrcs.add(isrc)

                name = (row.get("name") or "").strip() or None
                rd = (row.get("release_date") or "").strip()
                rd_iso = None
                try:
                    if rd:
                        rd_iso = date.fromisoformat(rd).isoformat()
                except Exception:
                    rd_iso = None

                track_meta.setdefault(
                    isrc,
                    {"isrc": isrc, "name": name, "release_date": rd_iso, "first_seen": run_date.isoformat(), "last_seen": run_date.isoformat()},
                )

                if is_catalog:
                    s = (row.get("spotify_streams_total") or "").strip()
                    try:
                        streams_total = int(float(s)) if s else 0
                    except Exception:
                        streams_total = 0
                    catalog_streams_today[isrc] = max(catalog_streams_today.get(isrc, 0), streams_total)
                    seen_stream_rows += 1
                    if streams_total == 0:
                        zero_streams += 1

            playlist_to_isrcs[pl_key] = isrcs
            if is_catalog and seen_stream_rows > 0:
                catalog_zero_stream_ratio[pl_key] = zero_streams / float(seen_stream_rows)

        # Persist raw export metadata early (useful even if we abort later).
        pg.upsert("raw_exports", raw_export_rows, on_conflict="run_id,playlist_key")

        # If any configured minimum row thresholds fail, abort BEFORE mutating memberships/stats.
        if hard_fail_warnings:
            pg.insert("ingestion_warnings", hard_fail_warnings)
            raise SystemExit("Critical export integrity checks failed (min_rows). Aborting ingestion.")

        # Additional hard safety: if catalog playlists swing wildly day-over-day, abort.
        # This catches cases where a page partially loaded (e.g., only first ~20 rows) even if min_rows isn't configured.
        swing_hard_fail: List[dict] = []
        for pl in playlists:
            pl_key = pl.playlist_key
            todays_isrcs = playlist_to_isrcs.get(pl_key)
            if not todays_isrcs:
                continue

            prev_stats = pg.select(
                "playlist_daily_stats",
                "track_count",
                f"playlist_key=eq.{pl_key}&date=eq.{prev_date.isoformat()}&limit=1",
            )
            prev_count = int(prev_stats[0]["track_count"]) if prev_stats and prev_stats[0].get("track_count") is not None else None
            if prev_count and prev_count > 0:
                ratio = abs(len(todays_isrcs) - prev_count) / float(prev_count)
                # For catalog exports, a huge swing is almost always a data integrity issue.
                if pl.is_catalog and ratio >= 0.70:
                    swing_hard_fail.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": pl_key,
                            "severity": "critical",
                            "code": "track_count_swing_hard_fail",
                            "message": f"Catalog track count changed by {ratio:.0%} day-over-day ({prev_count} -> {len(todays_isrcs)}); aborting ingestion",
                            "details_json": {"prev": prev_count, "today": len(todays_isrcs), "ratio": ratio},
                        }
                    )

        if swing_hard_fail:
            pg.insert("ingestion_warnings", swing_hard_fail)
            raise SystemExit("Critical export integrity checks failed (track_count swing). Aborting ingestion.")

        # tracks + daily snapshots
        pg.upsert("tracks", list(track_meta.values()), on_conflict="isrc")
        pg.upsert(
            "track_daily_streams",
            [{"date": run_date.isoformat(), "isrc": isrc, "streams_cumulative": v, "source_run_id": run_id} for isrc, v in catalog_streams_today.items()],
            on_conflict="date,isrc",
        )

        # memberships (skip derived)
        for pl_key, todays_isrcs in playlist_to_isrcs.items():
            if not todays_isrcs:
                continue
            active_rows = pg.select_all("playlist_memberships", "id,isrc", f"playlist_key=eq.{pl_key}&valid_to=is.null")
            active_set = {r["isrc"] for r in active_rows}
            active_id = {r["isrc"]: r["id"] for r in active_rows}
            to_add = sorted(todays_isrcs - active_set)
            to_remove = sorted(active_set - todays_isrcs)
            if to_add:
                # Upsert for idempotency (re-runs) and to avoid partial paging edge cases.
                pg.upsert(
                    "playlist_memberships",
                    [{"playlist_key": pl_key, "isrc": isrc, "valid_from": run_date.isoformat()} for isrc in to_add],
                    on_conflict="playlist_key,isrc,valid_from",
                )
            for isrc in to_remove:
                rid = active_id.get(isrc)
                if rid:
                    pg.patch("playlist_memberships", {"valid_to": prev_date.isoformat()}, f"id=eq.{rid}&valid_to=is.null")

        # derived all catalog set
        releases_set = playlist_to_isrcs.get("releases") or set()
        ext_set = playlist_to_isrcs.get("ext") or set()
        all_catalog_set = releases_set | ext_set
        if all_catalog_set:
            playlist_to_isrcs["all_catalog"] = all_catalog_set

        # stats + warnings
        stats_rows: List[dict] = []
        warn_rows: List[dict] = []

        for pl in playlists:
            pl_key = pl.playlist_key
            todays_isrcs = playlist_to_isrcs.get(pl_key)
            if not todays_isrcs:
                continue

            total = 0
            missing = 0
            missing_isrcs: List[str] = []
            for isrc in todays_isrcs:
                if isrc in catalog_streams_today:
                    total += int(catalog_streams_today[isrc])
                else:
                    if not is_excluded(pl_key, isrc):
                        missing += 1
                        missing_isrcs.append(isrc)

            prev_stats = pg.select(
                "playlist_daily_stats",
                "total_streams_cumulative,track_count",
                f"playlist_key=eq.{pl_key}&date=eq.{prev_date.isoformat()}&limit=1",
            )
            prev_total = int(prev_stats[0]["total_streams_cumulative"]) if prev_stats and prev_stats[0].get("total_streams_cumulative") is not None else None
            prev_count = int(prev_stats[0]["track_count"]) if prev_stats and prev_stats[0].get("track_count") is not None else None
            daily_net = (total - prev_total) if prev_total is not None else None

            stats_rows.append(
                {
                    "date": run_date.isoformat(),
                    "playlist_key": pl_key,
                    "track_count": len(todays_isrcs),
                    "total_streams_cumulative": total,
                    "daily_streams_net": daily_net,
                    "est_revenue_total": calc_rev(total),
                    "est_revenue_daily_net": calc_rev(daily_net) if daily_net is not None else None,
                    "missing_streams_track_count": missing,
                    "source_run_id": run_id,
                }
            )

            if missing > 0 and not pl.is_catalog:
                warn_rows.append(
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "warn",
                        "code": "non_catalog_tracks_present",
                        "message": f"{missing} track(s) in playlist have no catalog stream snapshot today",
                        "details_json": {
                            "missing_streams_track_count": missing,
                            # Include a small sample for debugging/UI; avoid huge payloads.
                            "missing_isrcs_sample": missing_isrcs[:100],
                            "missing_isrcs_total": len(missing_isrcs),
                            "exclusions_applied": True,
                        },
                    }
                )

            if prev_count and prev_count > 0:
                ratio = abs(len(todays_isrcs) - prev_count) / float(prev_count)
                if ratio >= TRACK_COUNT_SWING_WARN_RATIO:
                    warn_rows.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": pl_key,
                            "severity": "warn",
                            "code": "track_count_swing",
                            "message": f"Track count changed by {ratio:.0%} day-over-day ({prev_count} -> {len(todays_isrcs)})",
                            "details_json": {"prev": prev_count, "today": len(todays_isrcs), "ratio": ratio},
                        }
                    )

            if pl_key in catalog_zero_stream_ratio and catalog_zero_stream_ratio[pl_key] >= ZERO_STREAM_WARN_RATIO:
                zr = catalog_zero_stream_ratio[pl_key]
                warn_rows.append(
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "warn",
                        "code": "high_zero_stream_rate",
                        "message": f"High zero-stream rate in catalog export: {zr:.0%}",
                        "details_json": {"zero_stream_ratio": zr},
                    }
                )

        pg.upsert("playlist_daily_stats", stats_rows, on_conflict="date,playlist_key")
        if warn_rows:
            pg.insert("ingestion_warnings", warn_rows)

        pg.patch("ingestion_runs", {"status": "success", "finished_at": datetime.now(timezone.utc).isoformat()}, f"id=eq.{run_id}")
        print(f"✅ Ingestion complete for {run_date} (run_id={run_id})")

    except Exception as e:
        if run_id:
            try:
                pg.patch("ingestion_runs", {"status": "failed", "finished_at": datetime.now(timezone.utc).isoformat()}, f"id=eq.{run_id}")
                pg.insert(
                    "ingestion_warnings",
                    [
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": None,
                            "severity": "critical",
                            "code": "ingestion_exception",
                            "message": f"Ingestion exception: {repr(e)}",
                            "details_json": {"exception": repr(e)},
                        }
                    ],
                )
            except Exception:
                pass
        raise


if __name__ == "__main__":
    main()
