#!/usr/bin/env python
"""Step 2: stream the restored PostgreSQL tables into DuckDB (raw, verbatim, exact types).

Creates (fresh) <LEGACY_BUILD_DIR>/legacy_archive.duckdb with
  src_tracks (+in_stats_dump), src_milestones (+in_stats_dump), src_artists, src_songs_by_artist,
  pf_followers, meta.

Transport: psycopg COPY ... TO STDOUT (CSV, explicit NULL marker '\\N') -> cached CSV -> DuckDB read_csv
with explicit types and allow_quoted_nulls=false, so NULL and '' stay distinct.
The CSV cache (RAW_DIR/pgcopy) is keyed by dump SHA-256 + row count and is regenerated when absent/stale.

`_ev` (security artefact: the postgres process environment) is NOT copied; only its row count is recorded.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402

NULL = r"\N"
CACHE = C.RAW_DIR / "pgcopy"

# job name -> (db, table, ordered columns[(name, pg type, duckdb type)])
TABLES = {
    "stats2_tracks": ("stats2", "tracks", [
        ("id", "integer", "INTEGER"), ("playlist_id", "text", "VARCHAR"), ("spotify_track_id", "text", "VARCHAR"),
        ("song_name", "text", "VARCHAR"), ("artist", "text", "VARCHAR"), ("play_count", "integer", "INTEGER"),
        ("created_at", "timestamp without time zone", "TIMESTAMP")]),
    "stats2_milestones": ("stats2", "milestones", [
        ("id", "integer", "INTEGER"), ("song_name", "text", "VARCHAR"), ("artist", "text", "VARCHAR"),
        ("play_count", "integer", "INTEGER"), ("milestone", "text", "VARCHAR"),
        ("created_at", "timestamp without time zone", "TIMESTAMP")]),
    "stats2_artists": ("stats2", "artists", [("artist_name", "text", "VARCHAR")]),
    "stats2_songs_by_artist": ("stats2", "songs_by_artist", [("artist", "text", "VARCHAR"), ("song_name", "text", "VARCHAR")]),
    "stats_old_tracks": ("stats_old", "tracks", [
        ("id", "integer", "INTEGER"), ("playlist_id", "text", "VARCHAR"), ("spotify_track_id", "text", "VARCHAR"),
        ("song_name", "text", "VARCHAR"), ("artist", "text", "VARCHAR"), ("play_count", "integer", "INTEGER"),
        ("created_at", "timestamp without time zone", "TIMESTAMP")]),
    "stats_old_milestones": ("stats_old", "milestones", [
        ("id", "integer", "INTEGER"), ("song_name", "text", "VARCHAR"), ("artist", "text", "VARCHAR"),
        ("play_count", "integer", "INTEGER"), ("milestone", "text", "VARCHAR"),
        ("created_at", "timestamp without time zone", "TIMESTAMP")]),
    "pf_spotify_followers": ("playlistfollowers", "spotify_followers", [
        ("playlist_name", "text", "VARCHAR"), ("followers", "integer", "INTEGER"), ("account_name", "text", "VARCHAR"),
        ("user_id", "text", "VARCHAR"), ("playlist_id", "text", "VARCHAR"),
        ("timestamp", "timestamp without time zone", "TIMESTAMP")]),
}
# which dump each db comes from (for cache key)
DUMP_OF = C.DUMPS


def q(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def check_schema(job: str, ck: C.Checks) -> None:
    db, table, cols = TABLES[job]
    with C.pg_connect(db) as con:
        rows = con.execute(
            "select column_name, data_type from information_schema.columns "
            "where table_schema='public' and table_name=%s order by ordinal_position", (table,)).fetchall()
    ck.add(f"schema {db}.{table} columns/types", [(c[0], c[1]) for c in cols], [tuple(r) for r in rows],
           ok=[(c[0], c[1]) for c in cols] == [tuple(r) for r in rows])


def export_csv(job: str) -> tuple[str, Path, float, str]:
    db, table, cols = TABLES[job]
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{job}.csv"
    side = CACHE / f"{job}.csv.json"
    dump_sha = C.cached_sha256(DUMP_OF[db])
    expect_rows = C.EXPECTED[(db, table)]
    if out.exists() and side.exists():
        try:
            m = json.loads(side.read_text())
            if (m.get("dump_sha256") == dump_sha and m.get("rows") == expect_rows and m.get("null") == NULL
                    and m.get("cols") == [c[0] for c in cols] and m.get("bytes") == out.stat().st_size):
                return job, out, 0.0, "cached"
        except Exception:
            pass
    t0 = time.time()
    sql = f"COPY (SELECT {', '.join(q(c[0]) for c in cols)} FROM public.{q(table)}) TO STDOUT WITH (FORMAT csv, HEADER true, NULL '{NULL}')"
    tmp = out.with_suffix(".csv.part")
    with C.pg_connect(db) as con, con.cursor() as cur, open(tmp, "wb") as f:
        with cur.copy(sql) as cp:
            for chunk in cp:
                f.write(chunk)
    tmp.replace(out)
    side.write_text(json.dumps({"dump_sha256": dump_sha, "rows": expect_rows, "null": NULL,
                                "cols": [c[0] for c in cols], "bytes": out.stat().st_size,
                                "exported_at": C.now_iso()}))
    return job, out, time.time() - t0, "exported"


def read_csv_sql(job: str) -> str:
    _, _, cols = TABLES[job]
    types = ", ".join(f"{q(c[0])}: '{c[2]}'" for c in cols)
    return (f"read_csv('{(CACHE / (job + '.csv')).as_posix()}', header=true, columns={{{types}}}, "
            f"nullstr='{NULL}', allow_quoted_nulls=false, quote='\"', escape='\"', delim=',', "
            f"strict_mode=true, parallel=true)")


# ------------------------------------------------------------------------------------------------
def pg_profile(db: str, table: str, cols) -> dict:
    sel = ["count(*)"]
    names = ["rows"]
    for n, pt, _ in cols:
        sel.append(f"count(*) filter (where {q(n)} is null)")
        names.append(f"{n}__nulls")
        if pt == "text":
            sel.append(f"count(*) filter (where {q(n)} = '')")
            names.append(f"{n}__empty")
            sel.append(f"coalesce(sum(octet_length({q(n)})),0)")
            names.append(f"{n}__bytes")
        elif pt == "integer":
            sel.append(f"coalesce(sum({q(n)}::numeric),0)")
            names.append(f"{n}__sum")
        else:
            sel.append(f"min({q(n)})")
            names.append(f"{n}__min")
            sel.append(f"max({q(n)})")
            names.append(f"{n}__max")
            sel.append(f"coalesce(sum(extract(epoch from {q(n)}) * 1000000), 0)")
            names.append(f"{n}__epoch_us_sum")
    with C.pg_connect(db) as con:
        row = con.execute(f"select {', '.join(sel)} from public.{q(table)}").fetchone()
    out = {}
    for k, v in zip(names, row):
        out[k] = v
    return out


def duck_profile(con, tname: str, cols) -> dict:
    sel = ["count(*)"]
    names = ["rows"]
    for n, pt, _ in cols:
        sel.append(f"count(*) filter (where {q(n)} is null)")
        names.append(f"{n}__nulls")
        if pt == "text":
            sel.append(f"count(*) filter (where {q(n)} = '')")
            names.append(f"{n}__empty")
            sel.append(f"coalesce(sum(strlen({q(n)})),0)")
            names.append(f"{n}__bytes")
        elif pt == "integer":
            sel.append(f"coalesce(sum({q(n)}::HUGEINT),0)")
            names.append(f"{n}__sum")
        else:
            sel.append(f"min({q(n)})")
            names.append(f"{n}__min")
            sel.append(f"max({q(n)})")
            names.append(f"{n}__max")
            sel.append(f"coalesce(sum(epoch_us({q(n)})::HUGEINT), 0)")
            names.append(f"{n}__epoch_us_sum")
    row = con.execute(f"select {', '.join(sel)} from {tname}").fetchone()
    return dict(zip(names, row))


def norm(v):
    if hasattr(v, "as_integer_ratio") and not isinstance(v, float):
        return int(v)
    try:
        from decimal import Decimal
        if isinstance(v, Decimal):
            return int(v) if v == v.to_integral_value() else str(v)
    except Exception:
        pass
    return v


def verify_profile(ck: C.Checks, con, tname: str, job: str) -> dict:
    db, table, cols = TABLES[job]
    pg = {k: norm(v) for k, v in pg_profile(db, table, cols).items()}
    dd = {k: norm(v) for k, v in duck_profile(con, tname, cols).items()}
    diffs = {k: (pg[k], dd.get(k)) for k in pg if pg[k] != dd.get(k)}
    ck.add(f"PG vs DuckDB profile {db}.{table} -> {tname} ({len(pg)} measures: count, per-column nulls/empties/bytes, sums, min/max)",
           0, len(diffs), note=("diffs=" + json.dumps(diffs, default=str)[:600]) if diffs else "identical")
    return {k: (str(v) if not isinstance(v, (int, str, type(None))) else v) for k, v in pg.items()}


def main() -> int:
    ck = C.Checks("export_raw")
    t_start = time.time()
    C.BUILD_DIR.mkdir(parents=True, exist_ok=True)

    C.banner("export_raw: PG schema checks")
    for job in TABLES:
        check_schema(job, ck)

    C.banner("export_raw: PG -> CSV (parallel)")
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(export_csv, list(TABLES)))
    for job, path, secs, how in results:
        print(f"  {job}: {how} {path.stat().st_size / 1e6:,.0f} MB in {secs:.0f}s", flush=True)

    C.banner("export_raw: DuckDB load")
    for p in (C.OUT_DB, Path(str(C.OUT_DB) + ".wal")):
        if p.exists():
            p.unlink()
    scratch = C.BUILD_DIR / "stats_old_scratch.duckdb"
    for p in (scratch, Path(str(scratch) + ".wal")):
        if p.exists():
            p.unlink()
    con = C.duck_connect(C.OUT_DB)
    con.execute("SET preserve_insertion_order=false")
    con.execute(f"ATTACH '{scratch.as_posix()}' AS scratch")
    C.meta_init(con)

    def rc(job): return read_csv_sql(job)

    t0 = time.time()
    con.execute(f"CREATE TABLE scratch.old_tracks AS SELECT * FROM {rc('stats_old_tracks')}")
    con.execute(f"CREATE TABLE scratch.old_milestones AS SELECT * FROM {rc('stats_old_milestones')}")
    print(f"  loaded stats_old into scratch in {time.time() - t0:.0f}s", flush=True)

    # --- raw copies with the in_stats_dump flag: true iff same id AND identical columns in stats_old ----
    t0 = time.time()
    tcols = ["id", "playlist_id", "spotify_track_id", "song_name", "artist", "play_count", "created_at"]
    mcols = ["id", "song_name", "artist", "play_count", "milestone", "created_at"]

    def flag_sql(src_csv_job: str, old: str, cols: list[str]) -> str:
        cond = " AND ".join(f"t.{q(c)} IS NOT DISTINCT FROM o.{q(c)}" for c in cols)
        sel = ", ".join(f"t.{q(c)}" for c in cols)
        return (f"SELECT {sel}, (o.id IS NOT NULL) AS in_stats_dump FROM {rc(src_csv_job)} t "
                f"LEFT JOIN scratch.{old} o ON t.id = o.id AND {cond} ORDER BY t.id")

    con.execute("CREATE TABLE src_tracks AS " + flag_sql("stats2_tracks", "old_tracks", tcols))
    print(f"  src_tracks built in {time.time() - t0:.0f}s", flush=True)
    con.execute("CREATE TABLE src_milestones AS " + flag_sql("stats2_milestones", "old_milestones", mcols))
    con.execute(f"CREATE TABLE src_artists AS SELECT * FROM {rc('stats2_artists')} ORDER BY artist_name")
    con.execute(f"CREATE TABLE src_songs_by_artist AS SELECT * FROM {rc('stats2_songs_by_artist')} ORDER BY artist, song_name")
    con.execute(f"CREATE TABLE pf_followers AS SELECT * FROM {rc('pf_spotify_followers')} ORDER BY \"timestamp\", playlist_id, account_name, user_id, playlist_name, followers")

    C.banner("export_raw: stats_old subset verification (every id, every column)")
    for name, old, flagged, cols, expect in (
        ("tracks", "old_tracks", "src_tracks", tcols, C.EXPECTED[("stats_old", "tracks")]),
        ("milestones", "old_milestones", "src_milestones", mcols, C.EXPECTED[("stats_old", "milestones")]),
    ):
        n_old = con.execute(f"SELECT count(*) FROM scratch.{old}").fetchone()[0]
        uniq_old = con.execute(f"SELECT count(DISTINCT id) FROM scratch.{old}").fetchone()[0]
        uniq_new = con.execute(f"SELECT count(*) - count(DISTINCT id) FROM {flagged}").fetchone()[0]
        n_flag = con.execute(f"SELECT count(*) FROM {flagged} WHERE in_stats_dump").fetchone()[0]
        n_missing = con.execute(f"SELECT count(*) FROM scratch.{old} o ANTI JOIN {flagged} t ON t.id=o.id").fetchone()[0]
        ck.add(f"stats_old.{name} rows", expect, n_old)
        ck.add(f"stats_old.{name} ids unique", n_old, uniq_old)
        ck.add(f"stats2.{name} duplicate ids", 0, uniq_new)
        ck.add(f"stats_old.{name} ids absent from stats2", 0, n_missing)
        ck.add(f"stats_old.{name} rows with identical id+all columns in stats2 (in_stats_dump=true)", n_old, n_flag,
               note="every stats_old row is a byte-identical subset of stats2" if n_old == n_flag else "SUBSET CLAIM VIOLATED")

    C.banner("export_raw: PG vs DuckDB profile verification")
    profiles = {}
    profiles["src_tracks"] = verify_profile(ck, con, "src_tracks", "stats2_tracks")
    profiles["src_milestones"] = verify_profile(ck, con, "src_milestones", "stats2_milestones")
    profiles["src_artists"] = verify_profile(ck, con, "src_artists", "stats2_artists")
    profiles["src_songs_by_artist"] = verify_profile(ck, con, "src_songs_by_artist", "stats2_songs_by_artist")
    profiles["pf_followers"] = verify_profile(ck, con, "pf_followers", "pf_spotify_followers")
    profiles["scratch.old_tracks"] = verify_profile(ck, con, "scratch.old_tracks", "stats_old_tracks")
    profiles["scratch.old_milestones"] = verify_profile(ck, con, "scratch.old_milestones", "stats_old_milestones")
    # extra: the flagged subset must itself profile like stats_old (sums over flagged rows)
    for name, old in (("src_tracks", "old_tracks"), ("src_milestones", "old_milestones")):
        a = con.execute(f"SELECT count(*), sum(id::HUGEINT), coalesce(sum(play_count::HUGEINT),0), min(created_at), max(created_at) FROM {name} WHERE in_stats_dump").fetchone()
        b = con.execute(f"SELECT count(*), sum(id::HUGEINT), coalesce(sum(play_count::HUGEINT),0), min(created_at), max(created_at) FROM scratch.{old}").fetchone()
        ck.add(f"{name} WHERE in_stats_dump == stats_old profile", [norm(x) for x in b], [norm(x) for x in a])

    # --- meta ------------------------------------------------------------------------------------
    for (db, table), n in C.EXPECTED.items():
        if table == "_ev":
            continue
    with C.pg_connect("stats2") as pg:
        ev_rows = pg.execute("select count(*) from public._ev").fetchone()[0]
    ck.add("stats2._ev rows (recorded only, not copied)", C.EXPECTED[("stats2", "_ev")], ev_rows)
    C.meta_set(con, "stats2_ev_rows", {"rows": ev_rows,
        "note": "_ev holds the postgres process environment (evidence of COPY ... FROM PROGRAM / server compromise). "
                "Security artefact: NOT copied into the archive database, only counted."})
    C.meta_set(con, "raw_profiles", profiles)
    C.meta_set(con, "stats_old_subset_verified", {"tracks": C.EXPECTED[("stats_old", "tracks")],
                                                   "milestones": C.EXPECTED[("stats_old", "milestones")],
                                                   "rule": "every stats_old row exists in stats2 with the same id and identical values in all columns"})
    C.meta_set(con, "source_sha256", {
        "dumps": {db: {"file": C.rel_to_archive(p), "sha256": C.cached_sha256(p), "bytes": p.stat().st_size} for db, p in C.DUMPS.items()},
        "grafana_stats2": {"file": C.rel_to_archive(C.GRAFANA_STATS2), "sha256": C.cached_sha256(C.GRAFANA_STATS2)},
        "grafana_playlist_followers": {"file": C.rel_to_archive(C.GRAFANA_PF), "sha256": C.cached_sha256(C.GRAFANA_PF)},
    })
    C.meta_set(con, "pg_server", {"version": _pg_version()})
    C.meta_set(con, "export_raw", {"script_version": C.SCRIPT_VERSION, "finished_at": C.now_iso(),
                                   "seconds": round(time.time() - t_start, 1),
                                   "csv_nullmarker": NULL, "duckdb_version": _duck_version(con)})
    tr = con.execute("SELECT min(created_at), max(created_at) FROM src_tracks").fetchone()
    C.meta_set(con, "stats2_tracks_range", {"min": str(tr[0]), "max": str(tr[1])})
    pr = con.execute("SELECT min(\"timestamp\"), max(\"timestamp\") FROM pf_followers").fetchone()
    C.meta_set(con, "pf_followers_range", {"min": str(pr[0]), "max": str(pr[1])})
    con.execute("DETACH scratch")
    con.execute("CHECKPOINT")
    con.close()
    for p in (scratch, Path(str(scratch) + ".wal")):
        if p.exists():
            p.unlink()
    print(f"  export_raw total {time.time() - t_start:.0f}s", flush=True)
    return ck.finish()


def _pg_version() -> str:
    with C.pg_connect("postgres") as con:
        return con.execute("show server_version").fetchone()[0]


def _duck_version(con) -> str:
    return con.execute("select version()").fetchone()[0]


if __name__ == "__main__":
    sys.exit(main())
