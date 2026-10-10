#!/usr/bin/env python
"""Step 1: restore the three PostgreSQL dumps into a project-local portable cluster (idempotent).

* Cluster: initdb + start only if needed. The cluster is NEVER stopped or dropped here (other
  workers may be reading it).
* Databases already present with the expected row counts are skipped (not re-restored).
* A database that exists with the WRONG counts is a hard failure (never auto-dropped);
  pass --force-recreate to drop + restore it.
* Dump SHA-256 (cached in source_hashes.json) is compared with the archive's own checksum list.

Usage:  python restore_sources.py [--pg-bin DIR] [--pg-data DIR] [--port N] [--force-recreate DB ...]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402


def cluster_up() -> bool:
    import psycopg
    try:
        with psycopg.connect(C.pg_dsn("postgres"), autocommit=True) as con:
            con.execute("select 1")
        return True
    except Exception:
        return False


def ensure_cluster(ck: C.Checks) -> None:
    if cluster_up():
        ck.add("cluster reachable (already running)", True, True)
        return
    exe = lambda n: str(C.PG_BIN / (n + (".exe" if os.name == "nt" else "")))
    if not (C.PG_DATA / "PG_VERSION").exists():
        print(f"  initdb -> {C.PG_DATA}", flush=True)
        C.PG_DATA.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([exe("initdb"), "-D", str(C.PG_DATA), "-U", C.PG_USER, "-A", "trust",
                        "-E", "UTF8", "--locale=C"], check=True)
    log = C.PG_DATA.parent / "legacy-pg.log"
    print("  pg_ctl start", flush=True)
    subprocess.run([exe("pg_ctl"), "start", "-D", str(C.PG_DATA), "-l", str(log), "-w", "-t", "120",
                    "-o", f'-p {C.PG_PORT} -c listen_addresses={C.PG_HOST}'], check=True)
    for _ in range(30):
        if cluster_up():
            break
        time.sleep(1)
    ck.add("cluster reachable (started by this script)", True, cluster_up())


def table_counts(db: str, tables: list[str]) -> dict[str, int | None]:
    out: dict[str, int | None] = {}
    with C.pg_connect(db) as con:
        for t in tables:
            try:
                out[t] = con.execute(f'select count(*) from public."{t}"').fetchone()[0]
            except Exception:
                out[t] = None
    return out


def expected_for(db: str) -> dict[str, int]:
    return {t: n for (d, t), n in C.EXPECTED.items() if d == db}


def db_exists(name: str) -> bool:
    with C.pg_connect("postgres") as con:
        return con.execute("select 1 from pg_database where datname=%s", (name,)).fetchone() is not None


def restore_db(db: str, dump: Path) -> None:
    exe = lambda n: str(C.PG_BIN / (n + (".exe" if os.name == "nt" else "")))
    with C.pg_connect("postgres") as con:
        con.execute(f'create database "{db}" encoding \'UTF8\' template template0')
    print(f"  pg_restore {dump.name} -> {db} (this can take several minutes)", flush=True)
    t0 = time.time()
    r = subprocess.run([exe("pg_restore"), "--no-owner", "--no-acl", "-j", "8",
                        "-h", C.PG_HOST, "-p", str(C.PG_PORT), "-U", C.PG_USER, "-d", db, str(dump)])
    print(f"  pg_restore exit={r.returncode} in {time.time() - t0:.0f}s", flush=True)
    if r.returncode != 0:
        # pg_restore returns non-zero for warnings too (e.g. missing role/extension). Counts decide.
        print("  (non-zero exit: relying on row-count verification)", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin")
    ap.add_argument("--pg-data")
    ap.add_argument("--port", type=int)
    ap.add_argument("--force-recreate", nargs="*", default=[], help="drop+restore these DBs")
    a = ap.parse_args()
    if a.pg_bin:
        C.PG_BIN = Path(a.pg_bin)
    if a.pg_data:
        C.PG_DATA = Path(a.pg_data)
    if a.port:
        C.PG_PORT = a.port

    ck = C.Checks("restore_sources")
    C.banner("restore_sources: dump hashes")
    recorded = C.archive_recorded_sums()
    for db, dump in C.DUMPS.items():
        if not dump.exists():
            ck.add(f"dump present: {dump.name}", True, False)
            continue
        digest = C.cached_sha256(dump)
        rec = recorded.get(C.rel_to_archive(dump))
        ck.add(f"sha256 {db} dump matches archive SHA256SUMS.local.txt", rec, digest,
               note=f"{dump.stat().st_size:,} bytes; sha256={digest}", ok=(rec is None or rec == digest))
    for g in (C.GRAFANA_STATS2, C.GRAFANA_PF):
        digest = C.cached_sha256(g)
        rec = recorded.get(C.rel_to_archive(g))
        ck.add(f"sha256 grafana.db {g.parent.parent.name} matches archive record", rec, digest,
               ok=(rec is None or rec == digest))

    C.banner("restore_sources: cluster")
    ensure_cluster(ck)

    C.banner("restore_sources: databases")
    for db, dump in C.DUMPS.items():
        want = expected_for(db)
        if db in a.force_recreate and db_exists(db):
            with C.pg_connect("postgres") as con:
                con.execute(f'drop database "{db}" with (force)')
        if db_exists(db):
            have = table_counts(db, list(want))
            if have == want:
                ck.add(f"db {db}: present, row counts match -> skipped restore", want, have)
                continue
            ck.add(f"db {db}: exists but row counts differ (refusing to touch it)", want, have)
            continue
        restore_db(db, dump)
        have = table_counts(db, list(want))
        ck.add(f"db {db}: restored, row counts", want, have)
    return ck.finish()


if __name__ == "__main__":
    sys.exit(main())
