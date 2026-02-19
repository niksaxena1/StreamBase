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

STREAM_PAYOUT_USD = 0.002

# Warning thresholds (tune later)
TRACK_COUNT_SWING_WARN_RATIO = 0.30  # 30% day-over-day swing
ZERO_STREAM_WARN_RATIO = 0.60  # 60% rows with 0 cumulative streams (catalog exports only)
CATALOG_TRACK_COUNT_DROP_CRITICAL = 5  # critical if catalog track_count drops by >5 day-over-day


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
    raw = (s or "").strip().upper()
    if not raw:
        return ""
    return re.sub(r"[^A-Z0-9]", "", raw)


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
    # Optional: taken-down/unplayable track ignores (separate table).
    unplayable_global: Set[str] = set()
    unplayable_by_playlist: Dict[str, Set[str]] = {}

    def is_excluded(playlist_key: str, isrc: str) -> bool:
        if not isrc:
            return False
        if isrc in excluded_global:
            return True
        s = excluded_by_playlist.get(playlist_key)
        return bool(s and isrc in s)

    def is_unplayable_ignored(playlist_key: str, isrc: str) -> bool:
        if not isrc:
            return False
        if isrc in unplayable_global:
            return True
        s = unplayable_by_playlist.get(playlist_key)
        return bool(s and isrc in s)

    def is_missing_catalog_ignored(playlist_key: str, isrc: str) -> bool:
        # Combined rule for missing-catalog warning computations.
        return is_excluded(playlist_key, isrc) or is_unplayable_ignored(playlist_key, isrc)

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

        try:
            rows = pg.select_all(
                "health_unplayable_track_exclusions",
                "playlist_key,isrc",
                "",
                page_size=1000,
            )
            for r in rows:
                isrc = norm_isrc(r.get("isrc") or "")
                if not isrc:
                    continue
                plk = (r.get("playlist_key") or "").strip()
                if plk:
                    unplayable_by_playlist.setdefault(plk, set()).add(isrc)
                else:
                    unplayable_global.add(isrc)
        except Exception:
            # Table might not exist yet; ignore.
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
        # ISRCs whose catalog stream total was missing/blank/unparseable in today's export.
        missing_catalog_stream_value_isrcs: Set[str] = set()
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
                    streams_total: Optional[int] = None
                    if s:
                        # Best-effort parse: handle "1,234" and "1234.0".
                        try:
                            streams_total = int(float(s.replace(",", "")))
                        except Exception:
                            streams_total = None

                    if streams_total is None:
                        # SpotOnTrack sometimes exports blank / non-numeric values for certain rows.
                        # Treat as "missing".
                        missing_catalog_stream_value_isrcs.add(isrc)
                    else:
                        missing_catalog_stream_value_isrcs.discard(isrc)
                        catalog_streams_today[isrc] = max(catalog_streams_today.get(isrc, 0), streams_total)
                        seen_stream_rows += 1
                        if streams_total == 0:
                            zero_streams += 1

            playlist_to_isrcs[pl_key] = isrcs
            if is_catalog and seen_stream_rows > 0:
                catalog_zero_stream_ratio[pl_key] = zero_streams / float(seen_stream_rows)

        # Persist raw export metadata early (useful even if we abort later).
        pg.upsert("raw_exports", raw_export_rows, on_conflict="run_id,playlist_key")

        # Missing catalog stream handling:
        # - If a value is missing today, count it as 0 UNLESS yesterday had a non-zero value.
        # - If yesterday had a non-zero value, do NOT carry-forward; record it as "missing" by
        #   omitting today's snapshot row for that ISRC (streams_cumulative is NOT NULL in DB).
        #   We also emit a critical health warning listing affected ISRCs.
        prev_streams_rows = pg.select_all(
            "track_daily_streams",
            "isrc,streams_cumulative",
            f"date=eq.{prev_date.isoformat()}",
            page_size=1000,
        )
        prev_streams: Dict[str, int] = {}
        for r in prev_streams_rows:
            isrc = norm_isrc(r.get("isrc") or "")
            if not isrc:
                continue
            try:
                prev_streams[isrc] = int(r.get("streams_cumulative") or 0)
            except Exception:
                pass

        missing_prev_nonzero: List[dict] = []
        missing_prev_zero_or_unknown: List[str] = []
        for isrc in sorted(missing_catalog_stream_value_isrcs):
            pv = int(prev_streams.get(isrc, 0) or 0)
            if pv > 0:
                # Record as missing (omit from today's snapshots; do not carry-forward).
                missing_prev_nonzero.append({"isrc": isrc, "prev_streams_cumulative": pv})
                # Ensure we don't accidentally insert a 0 snapshot for this ISRC.
                catalog_streams_today.pop(isrc, None)
            else:
                # Count as 0 for today.
                catalog_streams_today[isrc] = 0
                missing_prev_zero_or_unknown.append(isrc)

        if missing_prev_nonzero:
            # Map affected ISRCs to the playlists they appear in today.
            affected_isrcs = [d["isrc"] for d in missing_prev_nonzero]
            affected_by_playlist: Dict[str, int] = {}
            sample_by_playlist: Dict[str, List[str]] = {}
            for pl_key, isrcs in playlist_to_isrcs.items():
                hits = [i for i in affected_isrcs if i in isrcs]
                if hits:
                    affected_by_playlist[pl_key] = len(hits)
                    sample_by_playlist[pl_key] = hits[:25]

            pg.insert(
                "ingestion_warnings",
                [
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": "all_catalog",
                        "severity": "critical",
                        "code": "catalog_streams_missing_prev_nonzero",
                        "message": (
                            "SpotOnTrack export missing/blank stream totals for tracks that had non-zero "
                            "cumulative streams yesterday. These tracks are recorded as missing today."
                        ),
                        "details_json": {
                            "affected_count": len(missing_prev_nonzero),
                            "affected_isrcs_with_prev_sample": missing_prev_nonzero[:100],
                            "affected_by_playlist": affected_by_playlist,
                            "affected_isrcs_sample_by_playlist": sample_by_playlist,
                            "missing_prev_zero_or_unknown_count": len(missing_prev_zero_or_unknown),
                            "missing_prev_zero_or_unknown_sample": missing_prev_zero_or_unknown[:100],
                            "note": "Decision on how to impute/repair missing values is pending.",
                        },
                    }
                ],
            )

        # Explicit missing snapshot counts (catalog stream snapshots).
        # A "missing snapshot" here means: the track appeared in a *catalog* export today,
        # but we do not have a valid numeric `streams_cumulative` to store in `track_daily_streams`.
        # (This includes the "prev non-zero → record as missing" policy above.)
        expected_catalog_isrcs: Set[str] = set()
        for pl_key, isrcs in playlist_to_isrcs.items():
            pl_cfg = playlist_lookup.get(pl_key)
            if pl_cfg and pl_cfg.is_catalog:
                expected_catalog_isrcs |= set(isrcs)

        present_snapshot_isrcs = set(catalog_streams_today.keys())
        missing_snapshot_isrcs = sorted(expected_catalog_isrcs - present_snapshot_isrcs)

        if missing_snapshot_isrcs:
            missing_by_playlist: Dict[str, int] = {}
            sample_by_playlist: Dict[str, List[str]] = {}
            for pl_key, isrcs in playlist_to_isrcs.items():
                pl_cfg = playlist_lookup.get(pl_key)
                if not (pl_cfg and pl_cfg.is_catalog):
                    continue
                missing_here = [i for i in missing_snapshot_isrcs if i in isrcs]
                if missing_here:
                    missing_by_playlist[pl_key] = len(missing_here)
                    sample_by_playlist[pl_key] = missing_here[:25]

            pg.insert(
                "ingestion_warnings",
                [
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": "all_catalog",
                        "severity": "critical",
                        "code": "catalog_missing_stream_snapshots",
                        "message": f"Missing catalog stream snapshots for {len(missing_snapshot_isrcs)} track(s) today",
                        "details_json": {
                            "expected_catalog_tracks_count": len(expected_catalog_isrcs),
                            "present_stream_snapshots_count": len(present_snapshot_isrcs),
                            "missing_stream_snapshots_count": len(missing_snapshot_isrcs),
                            "missing_isrcs_sample": missing_snapshot_isrcs[:200],
                            "missing_by_playlist": missing_by_playlist,
                            "missing_isrcs_sample_by_playlist": sample_by_playlist,
                            "note": "These tracks appeared in a catalog export but had missing/invalid stream totals and were not written to track_daily_streams.",
                        },
                    }
                ],
            )

        # --- Stale source data detection ---
        # If Spotify itself didn't update stream counts, most ISRCs will have identical
        # cumulative values as yesterday. Detect and emit a health warning (data is still
        # ingested as-is; manual overrides can be used to correct if needed).
        stale_data_detected = False
        common_isrcs = set(catalog_streams_today.keys()) & set(prev_streams.keys())
        if len(common_isrcs) >= 50:
            identical_count = sum(
                1 for isrc in common_isrcs
                if catalog_streams_today.get(isrc) == prev_streams.get(isrc)
            )
            identical_ratio = identical_count / len(common_isrcs)
            if identical_ratio >= 0.90:
                stale_data_detected = True
                pg.insert(
                    "ingestion_warnings",
                    [
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": "all_catalog",
                            "severity": "warn",
                            "code": "stale_source_data",
                            "message": (
                                f"Spotify likely did not update stream counts: "
                                f"{identical_ratio:.0%} of tracks ({identical_count}/{len(common_isrcs)}) "
                                f"have identical cumulative streams as yesterday"
                            ),
                            "details_json": {
                                "identical_count": identical_count,
                                "common_isrcs_count": len(common_isrcs),
                                "identical_ratio": round(identical_ratio, 4),
                                "note": (
                                    "SpotOnTrack exported the same stream totals as the previous day. "
                                    "This typically means Spotify itself has not refreshed. Data was still "
                                    "ingested as-is; use manual overrides if correction is needed."
                                ),
                            },
                        }
                    ],
                )
                print(
                    f"  ⚠ Stale source data: {identical_ratio:.0%} of catalog streams identical to yesterday "
                    f"({identical_count}/{len(common_isrcs)} tracks)"
                )

        # --- Per-track stale detection ---
        # Flag individual tracks whose cumulative streams didn't change day-over-day,
        # above a configurable minimum threshold (from user_settings).
        # Additionally, only flag tracks whose 7-day average daily streams meet a
        # minimum threshold, to avoid false positives on low-streaming tracks.
        individual_tracks_stale_count = 0
        stale_track_threshold = 2000  # default
        stale_track_min_avg_daily = 10  # default
        try:
            settings_rows = pg.select(
                "user_settings",
                "stale_track_min_streams,stale_track_min_avg_daily",
                "limit=1",
            )
            if settings_rows:
                stale_track_threshold = int(settings_rows[0].get("stale_track_min_streams", 2000) or 2000)
                stale_track_min_avg_daily = int(settings_rows[0].get("stale_track_min_avg_daily", 10) or 10)
        except Exception:
            # Table/column may not exist yet; use default.
            pass

        # Fetch ISRCs excluded from stale track detection.
        stale_excluded_isrcs: set = set()
        try:
            excl_rows = pg.select_all(
                "health_warning_exclusions",
                "isrc",
                "code=eq.individual_tracks_stale&order=id",
            )
            for r in excl_rows:
                ex_isrc = str(r.get("isrc", "")).strip().upper()
                if ex_isrc:
                    stale_excluded_isrcs.add(ex_isrc)
            if stale_excluded_isrcs:
                print(f"  ℹ Stale track detection: {len(stale_excluded_isrcs)} excluded ISRC(s)")
        except Exception:
            # Table may not exist yet; no exclusions.
            pass

        # Phase 1: find candidate stale tracks (cumulative threshold only).
        candidate_stale_isrcs: List[str] = []
        candidate_stale_map: dict = {}
        for isrc in common_isrcs:
            if isrc.strip().upper() in stale_excluded_isrcs:
                continue
            today_val = catalog_streams_today.get(isrc)
            prev_val = prev_streams.get(isrc)
            if today_val is not None and prev_val is not None:
                if today_val == prev_val and prev_val >= stale_track_threshold:
                    candidate_stale_isrcs.append(isrc)
                    candidate_stale_map[isrc] = today_val

        # Phase 2: compute 7-day average daily streams for candidates and filter.
        stale_tracks: List[dict] = []
        if candidate_stale_isrcs and stale_track_min_avg_daily > 0:
            # Look back 8 days to compute 7 daily deltas.
            lookback_date = (run_date - timedelta(days=8)).isoformat()
            avg_daily_map: dict = {}  # isrc -> avg daily streams
            try:
                # Fetch historical streams for candidate ISRCs in batches.
                BATCH = 200
                for i in range(0, len(candidate_stale_isrcs), BATCH):
                    batch_isrcs = candidate_stale_isrcs[i : i + BATCH]
                    isrc_csv = ",".join(batch_isrcs)
                    hist_rows = pg.select_all(
                        "track_daily_streams",
                        "isrc,date,streams_cumulative",
                        f"isrc=in.({isrc_csv})&date=gte.{lookback_date}&order=isrc,date",
                    )
                    # Group by ISRC and compute avg.
                    from collections import defaultdict
                    isrc_history: dict = defaultdict(list)
                    for r in hist_rows:
                        h_isrc = str(r.get("isrc", "")).strip().upper()
                        h_cum = int(r.get("streams_cumulative", 0) or 0)
                        h_date = str(r.get("date", ""))
                        if h_isrc and h_date:
                            isrc_history[h_isrc].append((h_date, h_cum))
                    for h_isrc, points in isrc_history.items():
                        if len(points) < 2:
                            avg_daily_map[h_isrc] = 0
                            continue
                        points.sort(key=lambda p: p[0])
                        earliest_cum = points[0][1]
                        latest_cum = points[-1][1]
                        num_days = len(points) - 1
                        avg_daily = (latest_cum - earliest_cum) / num_days if num_days > 0 else 0
                        avg_daily_map[h_isrc] = avg_daily
            except Exception as e:
                print(f"  ⚠ Could not compute avg daily streams for stale candidates: {e}")
                # Fall back to including all candidates.
                avg_daily_map = {isrc: stale_track_min_avg_daily for isrc in candidate_stale_isrcs}

            for isrc in candidate_stale_isrcs:
                avg = avg_daily_map.get(isrc.strip().upper(), 0)
                if avg >= stale_track_min_avg_daily:
                    stale_tracks.append({
                        "isrc": isrc,
                        "streams_cumulative": candidate_stale_map[isrc],
                        "avg_daily_7d": round(avg, 1),
                    })
            print(
                f"  ℹ Per-track stale: {len(candidate_stale_isrcs)} candidates, "
                f"{len(stale_tracks)} above avg-daily threshold ({stale_track_min_avg_daily})"
            )
        elif candidate_stale_isrcs:
            # min_avg_daily is 0 → flag all candidates (no avg filter).
            for isrc in candidate_stale_isrcs:
                stale_tracks.append({"isrc": isrc, "streams_cumulative": candidate_stale_map[isrc]})

        individual_tracks_stale_count = len(stale_tracks)
        if stale_tracks:
            pg.insert(
                "ingestion_warnings",
                [
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": "all_catalog",
                        "severity": "critical" if len(stale_tracks) >= 25 else "warn",
                        "code": "individual_tracks_stale",
                        "message": (
                            f"{len(stale_tracks)} track(s) with >={stale_track_threshold:,} total streams "
                            f"and >={stale_track_min_avg_daily} avg daily streams "
                            f"had zero daily growth (streams identical to yesterday)"
                        ),
                        "details_json": {
                            "threshold_min_streams": stale_track_threshold,
                            "threshold_min_avg_daily": stale_track_min_avg_daily,
                            "affected_count": len(stale_tracks),
                            "affected_tracks": sorted(stale_tracks, key=lambda t: t["streams_cumulative"], reverse=True),
                        },
                    }
                ],
            )
            print(
                f"  ⚠ Per-track stale: {len(stale_tracks)} track(s) with >={stale_track_threshold:,} total streams "
                f"and >={stale_track_min_avg_daily} avg daily had zero daily growth"
            )

        # --- Excluded track streams zeroed detection ---
        # For tracks in the stale exclusion list, check if their total streams dropped to zero.
        # These tracks are expected to have frozen (non-changing) streams, so a drop to zero
        # signals a data-source glitch rather than a real change.
        excluded_tracks_zeroed: List[dict] = []
        for isrc in stale_excluded_isrcs:
            today_val = catalog_streams_today.get(isrc)
            prev_val = prev_streams.get(isrc)
            if today_val is not None and prev_val is not None:
                if today_val == 0 and prev_val > 0:
                    excluded_tracks_zeroed.append({"isrc": isrc, "prev_streams": prev_val})

        excluded_tracks_zeroed_count = len(excluded_tracks_zeroed)
        if excluded_tracks_zeroed:
            pg.insert(
                "ingestion_warnings",
                [
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": "all_catalog",
                        "severity": "critical",
                        "code": "excluded_track_streams_zeroed",
                        "message": (
                            f"{len(excluded_tracks_zeroed)} excluded track(s) had their total streams drop to zero"
                        ),
                        "details_json": {
                            "affected_count": len(excluded_tracks_zeroed),
                            "affected_tracks": sorted(
                                excluded_tracks_zeroed,
                                key=lambda t: t["prev_streams"],
                                reverse=True,
                            ),
                        },
                    }
                ],
            )
            print(
                f"  ⚠ Excluded track zeroed: {len(excluded_tracks_zeroed)} excluded track(s) "
                f"had total streams drop to zero"
            )

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
            active_rows = pg.select_all("playlist_memberships", "id,isrc", f"playlist_key=eq.{pl_key}&valid_to=is.null&order=id")
            active_set = {r["isrc"] for r in active_rows}
            active_id = {r["isrc"]: r["id"] for r in active_rows}
            to_add = sorted(todays_isrcs - active_set)
            to_remove = sorted(active_set - todays_isrcs)
            if to_add:
                # Upsert for idempotency (re-runs) and to avoid partial paging edge cases.
                add_rows = [{"playlist_key": pl_key, "isrc": isrc, "valid_from": run_date.isoformat()} for isrc in to_add]
                try:
                    pg.upsert(
                        "playlist_memberships",
                        add_rows,
                        on_conflict="playlist_key,isrc,valid_from",
                    )
                except RuntimeError as e:
                    if "23P01" not in str(e):
                        raise
                    # Exclusion constraint violation: a track we're trying to add already has
                    # an active (overlapping) membership that the pagination missed. Fall back
                    # to one-by-one inserts, closing the conflicting membership first.
                    print(f"  ⚠ Exclusion constraint hit for {pl_key}; falling back to row-by-row membership inserts")
                    for row in add_rows:
                        isrc = row["isrc"]
                        try:
                            # Close any existing active membership for this ISRC first.
                            conflicting = pg.select(
                                "playlist_memberships", "id",
                                f"playlist_key=eq.{pl_key}&isrc=eq.{isrc}&valid_to=is.null&limit=1",
                            )
                            if conflicting:
                                pg.patch(
                                    "playlist_memberships",
                                    {"valid_to": prev_date.isoformat()},
                                    f"id=eq.{conflicting[0]['id']}&valid_to=is.null",
                                )
                            pg.upsert(
                                "playlist_memberships",
                                [row],
                                on_conflict="playlist_key,isrc,valid_from",
                            )
                        except Exception as inner_e:
                            print(f"  ⚠ Membership fallback failed for {pl_key}/{isrc}: {inner_e}")
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
                    if not is_missing_catalog_ignored(pl_key, isrc):
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

            # Critical health check: cumulative total streams should not decrease day-over-day.
            # If it does, something is wrong with today's export (missing/blank values, parsing, or source bug).
            if prev_total is not None and total < prev_total:
                decreased_tracks = []
                for isrc in todays_isrcs:
                    today_val = int(catalog_streams_today.get(isrc, 0))
                    prev_val = int(prev_streams.get(isrc, 0))
                    if today_val < prev_val:
                        decreased_tracks.append({
                            "isrc": isrc,
                            "prev_streams": prev_val,
                            "today_streams": today_val,
                            "delta": today_val - prev_val,
                        })
                decreased_tracks.sort(key=lambda t: t["delta"])
                warn_rows.append(
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "critical",
                        "code": "total_streams_decreased",
                        "message": f"Total cumulative streams decreased day-over-day ({prev_total} -> {total})",
                        "details_json": {
                            "prev_total_streams_cumulative": prev_total,
                            "today_total_streams_cumulative": total,
                            "delta": int(total - prev_total),
                            "missing_streams_track_count": missing,
                            "decreased_tracks": decreased_tracks[:200],
                            "decreased_tracks_total": len(decreased_tracks),
                            "note": "Totals should be monotonic; investigate missing/invalid stream totals in source export.",
                        },
                    }
                )

            if missing > 0 and not pl.is_catalog:
                warn_rows.append(
                    {
                        "run_id": run_id,
                        "run_date": run_date.isoformat(),
                        "playlist_key": pl_key,
                        "severity": "critical",
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
                today_count = len(todays_isrcs)
                delta = today_count - prev_count
                ratio = abs(delta) / float(prev_count)

                # Critical: catalog track count drop by an absolute threshold (even if ratio is small).
                if pl.is_catalog and (prev_count - today_count) > CATALOG_TRACK_COUNT_DROP_CRITICAL:
                    warn_rows.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": pl_key,
                            "severity": "critical",
                            "code": "track_count_swing",
                            "message": f"Catalog track count dropped by {prev_count - today_count} day-over-day ({prev_count} -> {today_count})",
                            "details_json": {
                                "prev": prev_count,
                                "today": today_count,
                                "delta": delta,
                                "ratio": ratio,
                                "drop_threshold": CATALOG_TRACK_COUNT_DROP_CRITICAL,
                            },
                        }
                    )
                elif ratio >= TRACK_COUNT_SWING_WARN_RATIO:
                    warn_rows.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": pl_key,
                            "severity": "warn",
                            "code": "track_count_swing",
                            "message": f"Track count changed by {ratio:.0%} day-over-day ({prev_count} -> {today_count})",
                            "details_json": {"prev": prev_count, "today": today_count, "delta": delta, "ratio": ratio},
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

            # Check for tracks missing Spotify enrichment (artist names/ids)
            try:
                # Count tracks in this playlist that don't have Spotify enrichment data
                unenriched_isrcs = []
                for isrc in todays_isrcs:
                    # Check if this track is in track_meta and doesn't have enrichment yet
                    # For efficiency, we'll just check against what we have locally
                    pass
                
                # Query for tracks with null spotify_artist_ids
                unenriched = pg.select_all(
                    "tracks",
                    "isrc",
                    "spotify_artist_ids=is.null",
                    page_size=1000,
                )
                unenriched_set = {t["isrc"] for t in unenriched}
                unenriched_in_playlist = [isrc for isrc in todays_isrcs if isrc in unenriched_set]
                
                if len(unenriched_in_playlist) > 0:
                    warn_rows.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": pl_key,
                            "severity": "info",
                            "code": "tracks_missing_enrichment",
                            "message": f"{len(unenriched_in_playlist)} track(s) in playlist are missing Spotify enrichment data",
                            "details_json": {
                                "missing_enrichment_track_count": len(unenriched_in_playlist),
                                "isrc_list": unenriched_in_playlist,
                                "note": "Run the Spotify enrichment workflow to update artist names and metadata",
                            },
                        }
                    )
            except Exception:
                # If the enrichment check fails, don't block ingestion
                pass

        # --- Entity-vs-Distro drift check ---
        # Load entity_playlist_key mappings from DB and compare membership sets.
        try:
            entity_map_rows = pg.select_all(
                "playlists",
                "playlist_key,entity_playlist_key,display_name",
                "entity_playlist_key=not.is.null",
                page_size=200,
            )
            # Group distro playlists by their entity
            entity_to_distros: Dict[str, List[str]] = {}
            distro_display_names: Dict[str, str] = {}
            for r in entity_map_rows:
                epk = (r.get("entity_playlist_key") or "").strip()
                dpk = (r.get("playlist_key") or "").strip()
                if epk and dpk:
                    entity_to_distros.setdefault(epk, []).append(dpk)
                    distro_display_names[dpk] = (r.get("display_name") or dpk).strip()

            for entity_key, distro_keys in entity_to_distros.items():
                entity_isrcs = playlist_to_isrcs.get(entity_key, set())
                distro_union: Set[str] = set()
                for dk in distro_keys:
                    distro_union |= playlist_to_isrcs.get(dk, set())

                extra_in_distro = sorted(distro_union - entity_isrcs)
                missing_from_distro = sorted(entity_isrcs - distro_union)

                if extra_in_distro or missing_from_distro:
                    # Find entity display name
                    entity_display = entity_key
                    for pl in playlists:
                        if pl.playlist_key == entity_key:
                            entity_display = pl.display_name
                            break

                    parts = []
                    if extra_in_distro:
                        parts.append(f"{len(extra_in_distro)} extra in Distro")
                    if missing_from_distro:
                        parts.append(f"{len(missing_from_distro)} missing from Distro")
                    summary = "; ".join(parts)

                    warn_rows.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": entity_key,
                            "severity": "warn",
                            "code": "entity_distro_drift",
                            "message": f"Entity/Distro drift for {entity_display}: {summary}",
                            "details_json": {
                                "entity_playlist_key": entity_key,
                                "distro_playlist_keys": distro_keys,
                                "extra_in_distro_count": len(extra_in_distro),
                                "extra_in_distro_sample": extra_in_distro[:100],
                                "missing_from_distro_count": len(missing_from_distro),
                                "missing_from_distro_sample": missing_from_distro[:100],
                            },
                        }
                    )
                    print(
                        f"  ⚠ Entity/Distro drift for {entity_display}: {summary}"
                    )
        except Exception as drift_err:
            # Don't block ingestion if drift check fails
            print(f"  ⚠ Entity-distro drift check failed: {drift_err}")

        # --- Distro overlap check ---
        # Find ISRCs that appear in 2+ Distro playlists on the same day.
        # Each track should only be distributed through one Distro playlist at a time.
        try:
            distro_keys = [p.playlist_key for p in playlists if p.playlist_type == "Distro"]
            if len(distro_keys) >= 2:
                isrc_to_distro_playlists: Dict[str, List[str]] = {}
                for dk in distro_keys:
                    for isrc in playlist_to_isrcs.get(dk, set()):
                        isrc_to_distro_playlists.setdefault(isrc, []).append(dk)
                overlapping = {
                    isrc: sorted(pls)
                    for isrc, pls in isrc_to_distro_playlists.items()
                    if len(pls) >= 2
                }
                if overlapping:
                    warn_rows.append(
                        {
                            "run_id": run_id,
                            "run_date": run_date.isoformat(),
                            "playlist_key": None,
                            "severity": "warn",
                            "code": "distro_overlap",
                            "message": f"{len(overlapping)} track(s) appear in multiple Distro playlists",
                            "details_json": {
                                "overlap_count": len(overlapping),
                                "overlapping_isrcs_sample": [
                                    {"isrc": isrc, "playlist_keys": pls}
                                    for isrc, pls in sorted(overlapping.items())[:100]
                                ],
                            },
                        }
                    )
                    print(
                        f"  ⚠ Distro overlap: {len(overlapping)} track(s) in multiple Distro playlists"
                    )
        except Exception as overlap_err:
            # Don't block ingestion if overlap check fails
            print(f"  ⚠ Distro overlap check failed: {overlap_err}")

        pg.upsert("playlist_daily_stats", stats_rows, on_conflict="date,playlist_key")
        if warn_rows:
            pg.insert("ingestion_warnings", warn_rows)

        pg.patch("ingestion_runs", {"status": "success", "finished_at": datetime.now(timezone.utc).isoformat()}, f"id=eq.{run_id}")
        print(f"✅ Ingestion complete for {run_date} (run_id={run_id})")

        # Write machine-readable summary for CI notification workflow.
        ingestion_summary = {
            "status": "success",
            "run_date": run_date.isoformat(),
            "run_id": run_id,
            "stale_data_detected": stale_data_detected,
            "individual_tracks_stale_count": individual_tracks_stale_count,
            "excluded_tracks_zeroed_count": excluded_tracks_zeroed_count,
        }
        summary_path = Path(".artifacts") / "ingestion_summary.json"
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(ingestion_summary, indent=2))

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
