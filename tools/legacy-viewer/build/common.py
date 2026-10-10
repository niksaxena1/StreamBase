"""Shared constants and helpers for the legacy archive build pipeline.

Everything here is deterministic and read-only with respect to the archive folder.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

SCRIPT_VERSION = "2.0.0"

# --- paths (overridable through env) -------------------------------------------------------------
def required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Set {name}; see tools/legacy-viewer/README.md")
    return value


ARCHIVE = Path(required_env("LEGACY_ARCHIVE"))
PG_BIN = Path(required_env("LEGACY_PG_BIN"))
PG_DATA = Path(required_env("LEGACY_PG_DATA"))
PG_HOST = os.environ.get("LEGACY_PG_HOST", "127.0.0.1")
PG_PORT = int(os.environ.get("LEGACY_PG_PORT", "55432"))
PG_USER = required_env("LEGACY_PG_USER")
BUILD_DIR = Path(required_env("LEGACY_BUILD_DIR"))
RAW_DIR = BUILD_DIR / "raw"
TMP_DIR = BUILD_DIR / "tmp"
OUT_DB = BUILD_DIR / "legacy_archive.duckdb"
HASH_CACHE = BUILD_DIR / "source_hashes.json"
REPORT = BUILD_DIR / "build_report.json"
CHECKS_FILE = BUILD_DIR / "checks.jsonl"

# Keys are local restore aliases, never production database names.
DUMPS = {key: Path(required_env(env)) for key, env in (
    ("stats2", "LEGACY_STATS2_DUMP"),
    ("stats_old", "LEGACY_STATS_DUMP"),
    ("playlistfollowers", "LEGACY_FOLLOWERS_DUMP"),
)}
GRAFANA_STATS2 = Path(required_env("LEGACY_STATS2_GRAFANA"))
GRAFANA_STATS = Path(required_env("LEGACY_STATS_GRAFANA"))
GRAFANA_PF = Path(required_env("LEGACY_FOLLOWERS_GRAFANA"))
EXTRACT_DIR = Path(required_env("LEGACY_EXTRACT_DIR"))
RECON_DIR = EXTRACT_DIR / "reconciliation-final"
LEGACY_DAILY = EXTRACT_DIR / "legacy_daily_2023-07-08_to_2025-12-22.csv.gz"
LEGACY_DAILY_MANIFEST = EXTRACT_DIR / "legacy_daily_2023-07-08_to_2025-12-22.csv.gz.manifest.json"
MAPPED = RECON_DIR / "legacy_daily_mapped.csv.gz"
CANONICAL = RECON_DIR / "legacy_daily_canonical.csv.gz"
CATALOG_CSV = RECON_DIR / "legacy_catalog_daily_stats.csv"
SHA_LOCAL = ARCHIVE / "checksums" / "SHA256SUMS.local.txt"

# --- expected row counts (verified 2026-10-04) --------------------------------------------------
EXPECTED = {
    ("stats2", "tracks"): 34_325_689,
    ("stats2", "milestones"): 15_705,
    ("stats2", "artists"): 1_357,
    ("stats2", "songs_by_artist"): 2_756,
    ("stats2", "_ev"): 13,
    ("stats_old", "tracks"): 27_198_862,
    ("stats_old", "milestones"): 10_543,
    ("playlistfollowers", "spotify_followers"): 2_710_108,
}
EXPECT_TRACK_DAY_ROWS = 1_782_758
EXPECT_MAPPED_IDS = 3_209
EXPECT_ISRCS = 2_667


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# --- hashing ------------------------------------------------------------------------------------
def sha256_file(path: Path, chunk: int = 8 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def cached_sha256(path: Path) -> str:
    """SHA-256 with a (path,size,mtime_ns)-keyed json cache next to the output."""
    path = Path(path)
    st = path.stat()
    key = str(path)
    cache: dict[str, Any] = {}
    if HASH_CACHE.exists():
        try:
            cache = json.loads(HASH_CACHE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    ent = cache.get(key)
    if ent and ent.get("size") == st.st_size and ent.get("mtime_ns") == st.st_mtime_ns:
        return ent["sha256"]
    digest = sha256_file(path)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    cache[key] = {"sha256": digest, "size": st.st_size, "mtime_ns": st.st_mtime_ns, "computed_at": now_iso()}
    HASH_CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True), encoding="utf-8")
    return digest


def archive_recorded_sums() -> dict[str, str]:
    """relative-path (forward slash) -> sha256 recorded in the archive's own checksum file."""
    out: dict[str, str] = {}
    if not SHA_LOCAL.exists():
        return out
    for line in SHA_LOCAL.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.strip().split("  ", 1)
        if len(parts) == 2 and len(parts[0]) == 64:
            out[parts[1].replace("\\", "/")] = parts[0].lower()
    return out


def rel_to_archive(p: Path) -> str:
    return str(Path(p).relative_to(ARCHIVE)).replace("\\", "/")


# --- verification collector -----------------------------------------------------------------------
@dataclass
class Check:
    name: str
    passed: bool
    expected: Any = None
    actual: Any = None
    note: str = ""
    info: bool = False  # informational (never fails the build)


class Checks:
    """Appends every check to checks.jsonl so build_all can assemble the report across processes."""

    def __init__(self, stage: str):
        self.stage = stage
        self.items: list[Check] = []

    def add(self, name: str, expected: Any, actual: Any, note: str = "", ok: bool | None = None) -> bool:
        passed = (expected == actual) if ok is None else ok
        self._push(Check(name, bool(passed), _jsonable(expected), _jsonable(actual), note))
        mark = "PASS" if passed else "FAIL"
        print(f"  [{mark}] {name}: expected={expected!r} actual={actual!r}" + (f"  ({note})" if note else ""), flush=True)
        return bool(passed)

    def info(self, name: str, value: Any, note: str = "") -> None:
        self._push(Check(name, True, None, _jsonable(value), note, info=True))
        print(f"  [INFO] {name}: {value!r}" + (f"  ({note})" if note else ""), flush=True)

    def _push(self, c: Check) -> None:
        self.items.append(c)
        CHECKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CHECKS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({"stage": self.stage, **asdict(c)}, default=str) + "\n")

    def failed(self) -> list[Check]:
        return [c for c in self.items if not c.passed]

    def finish(self) -> int:
        bad = self.failed()
        print(f"[{self.stage}] {len(self.items)} checks, {len(bad)} failed", flush=True)
        return 1 if bad else 0


def _jsonable(v: Any) -> Any:
    try:
        json.dumps(v)
        return v
    except TypeError:
        return str(v)


def pg_dsn(db: str) -> str:
    return f"host={PG_HOST} port={PG_PORT} user={PG_USER} dbname={db} connect_timeout=5"


def pg_connect(db: str):
    import psycopg
    return psycopg.connect(pg_dsn(db), autocommit=True)


def duck_connect(path: Path | str = OUT_DB, read_only: bool = False):
    import duckdb
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(path), read_only=read_only)
    con.execute(f"SET temp_directory='{str(TMP_DIR).replace(chr(92), '/')}'")
    con.execute("SET threads=16")
    return con


def banner(msg: str) -> None:
    print(f"\n=== {msg} ===", flush=True)


def meta_init(con) -> None:
    con.execute("CREATE TABLE IF NOT EXISTS meta(key VARCHAR PRIMARY KEY, value JSON)")


def meta_set(con, key: str, value: Any) -> None:
    meta_init(con)
    con.execute("DELETE FROM meta WHERE key = ?", [key])
    con.execute("INSERT INTO meta VALUES (?, ?::JSON)", [key, json.dumps(value, default=str, sort_keys=True)])
