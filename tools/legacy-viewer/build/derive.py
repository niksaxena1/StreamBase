#!/usr/bin/env python
"""Step 3: build every derived table of ARCHITECTURE.md section 4 inside legacy_archive.duckdb.

Rules: NULL stays NULL, nothing is interpolated, resets are flagged (not hidden).
Datasets: every stream table carries a leading `dataset` column:
  'stats2' = all src_tracks rows,  'stats' = only rows with in_stats_dump (stats server subset).
Each dataset is computed from its own row set (not date-filtered from the other).

Idempotent: all derived objects are dropped and rebuilt; raw src_* tables are never modified.
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as C  # noqa: E402

DATASETS = [("stats2", "TRUE"), ("stats", "in_stats_dump")]
DERIVED_TABLES = ["isrc_map", "track_day", "isrc_day", "playlist_day", "playlist_track_day", "catalog_day",
                  "track_identity", "isrc_identity", "playlists", "pf_playlist_day", "pf_playlists"]


def p(path) -> str:
    return Path(path).as_posix().replace("'", "''")


def timed(label: str):
    class T:
        def __enter__(s):
            s.t = time.time()
            return s

        def __exit__(s, *a):
            print(f"  {label}: {time.time() - s.t:.1f}s", flush=True)
    return T()


# =================================================================================================
def build_isrc_map(con, ck: C.Checks) -> None:
    C.banner("derive: isrc_map")
    con.execute("DROP TABLE IF EXISTS isrc_map")
    con.execute(f"""
        CREATE TABLE isrc_map AS
        SELECT DISTINCT spotify_track_id, isrc, match_method
        FROM read_csv('{p(C.MAPPED)}', header=true)
        ORDER BY spotify_track_id""")
    n, ids, isrcs = con.execute("SELECT count(*), count(DISTINCT spotify_track_id), count(DISTINCT isrc) FROM isrc_map").fetchone()
    ck.add("isrc_map distinct spotify_track_id", C.EXPECT_MAPPED_IDS, ids)
    ck.add("isrc_map one row (one isrc, one match_method) per id", ids, n)
    ck.add("isrc_map distinct isrcs", C.EXPECT_ISRCS, isrcs)
    unmapped = con.execute("""
        SELECT count(*) FROM (SELECT DISTINCT spotify_track_id FROM src_tracks) s
        ANTI JOIN isrc_map m USING (spotify_track_id)""").fetchone()[0]
    ck.add("distinct src_tracks spotify_track_id without ISRC mapping", 0, unmapped,
           note="unmapped ids would be absent from isrc_day/catalog_day")
    ids_src = con.execute("SELECT count(DISTINCT spotify_track_id) FROM src_tracks").fetchone()[0]
    ck.info("distinct spotify_track_id in src_tracks", ids_src)
    nulls = con.execute("SELECT count(*) FILTER (WHERE play_count IS NULL) FROM src_tracks").fetchone()[0]
    ck.info("src_tracks rows with NULL play_count (kept as NULL, excluded from modes, counted as null_readings)", nulls)


# =================================================================================================
def build_track_day(con, ck: C.Checks) -> None:
    C.banner("derive: track_day (F1)")
    con.execute("DROP TABLE IF EXISTS track_day")
    parts = []
    for ds, cond in DATASETS:
        with timed(f"track_day[{ds}] base"):
            con.execute(f"DROP TABLE IF EXISTS _td_{ds}")
            con.execute(f"""
            CREATE TEMP TABLE _td_{ds} AS
            WITH o AS (
              SELECT created_at::DATE AS day, spotify_track_id, play_count, created_at
              FROM src_tracks WHERE {cond}
            ), agg AS (
              SELECT day, spotify_track_id,
                     count(play_count)::BIGINT                 AS observation_count,
                     (count(*) - count(play_count))::BIGINT    AS null_readings,
                     count(DISTINCT play_count)::BIGINT        AS distinct_play_counts,
                     min(created_at)                           AS first_obs,
                     max(created_at)                           AS last_obs
              FROM o GROUP BY day, spotify_track_id
            ), freq AS (
              SELECT day, spotify_track_id, play_count, count(*) AS f
              FROM o WHERE play_count IS NOT NULL GROUP BY day, spotify_track_id, play_count
            ), mode AS (
              SELECT day, spotify_track_id, play_count AS streams, f AS mode_frequency FROM (
                SELECT *, row_number() OVER (PARTITION BY day, spotify_track_id
                                             ORDER BY f DESC, play_count DESC) AS rn FROM freq)
              WHERE rn = 1
            )
            SELECT a.day, a.spotify_track_id, m.streams::BIGINT AS streams, m.mode_frequency::BIGINT AS mode_frequency,
                   a.observation_count, a.null_readings, a.distinct_play_counts,
                   m.mode_frequency::DOUBLE / NULLIF(a.observation_count, 0) AS mode_confidence,
                   a.first_obs, a.last_obs
            FROM agg a LEFT JOIN mode m USING (day, spotify_track_id)""")
        parts.append(f"""
            SELECT '{ds}'::VARCHAR AS dataset, b.day, b.spotify_track_id, im.isrc, b.streams, b.mode_frequency,
                   b.observation_count, b.null_readings, b.distinct_play_counts, b.mode_confidence,
                   b.first_obs, b.last_obs, w.prev_day,
                   CASE WHEN w.prev_day = b.day - 1 THEN b.streams - w.prev_streams END AS delta,
                   COALESCE(w.prev_day = b.day - 1 AND b.streams - w.prev_streams < 0, FALSE) AS is_reset
            FROM _td_{ds} b
            LEFT JOIN (
              SELECT day, spotify_track_id,
                     lag(day)     OVER (PARTITION BY spotify_track_id ORDER BY day) AS prev_day,
                     lag(streams) OVER (PARTITION BY spotify_track_id ORDER BY day) AS prev_streams
              FROM _td_{ds} WHERE streams IS NOT NULL
            ) w USING (day, spotify_track_id)
            LEFT JOIN isrc_map im USING (spotify_track_id)""")
    with timed("track_day combine+sort"):
        con.execute("CREATE TABLE track_day AS " + " UNION ALL ".join(parts) +
                    " ORDER BY dataset, spotify_track_id, day")
    for ds, _ in DATASETS:
        con.execute(f"DROP TABLE IF EXISTS _td_{ds}")
    n = con.execute("SELECT count(*) FROM track_day WHERE dataset='stats2'").fetchone()[0]
    ck.add("track_day[stats2] rows", C.EXPECT_TRACK_DAY_ROWS, n)
    ck.info("track_day[stats] rows", con.execute("SELECT count(*) FROM track_day WHERE dataset='stats'").fetchone()[0])

    # --- cross-check vs previous extract (stats2 rows only) ------------------------------------
    d = con.execute(f"""
        WITH p AS (SELECT snapshot_date::DATE AS day, spotify_track_id, streams_cumulative::BIGINT AS s,
                          mode_frequency::BIGINT AS mf, observation_count::BIGINT AS oc,
                          distinct_play_counts::BIGINT AS dpc, first_observed_at AS fo, last_observed_at AS lo
                   FROM read_csv('{p(C.LEGACY_DAILY)}', header=true)),
             t AS (SELECT day, spotify_track_id, streams AS s, mode_frequency AS mf, observation_count AS oc,
                          distinct_play_counts AS dpc, first_obs AS fo, last_obs AS lo
                   FROM track_day WHERE dataset='stats2')
        SELECT count(*) FILTER (WHERE p.day IS NULL)  AS only_ours,
               count(*) FILTER (WHERE t.day IS NULL)  AS only_prev,
               count(*) FILTER (WHERE p.day IS NOT NULL AND t.day IS NOT NULL AND
                    (p.s IS DISTINCT FROM t.s OR p.mf IS DISTINCT FROM t.mf OR p.oc IS DISTINCT FROM t.oc)) AS differ_core,
               count(*) FILTER (WHERE p.day IS NOT NULL AND t.day IS NOT NULL AND
                    (p.dpc IS DISTINCT FROM t.dpc OR p.fo IS DISTINCT FROM t.fo OR p.lo IS DISTINCT FROM t.lo)) AS differ_extra,
               count(*) AS total
        FROM p FULL OUTER JOIN t ON p.day = t.day AND p.spotify_track_id = t.spotify_track_id""").fetchone()
    ck.add("track_day[stats2] vs legacy_daily_2023-07-08_to_2025-12-22.csv.gz: rows only in ours", 0, d[0])
    ck.add("track_day[stats2] vs previous extract: rows only in previous extract", 0, d[1])
    ck.add("track_day[stats2] vs previous extract: (date,id,streams,mode_frequency,observation_count) mismatches", 0, d[2],
           note=f"compared {d[4]:,} joined/union rows")
    ck.add("track_day[stats2] vs previous extract: distinct_play_counts/first/last_observed mismatches", 0, d[3])

    # --- stats vs stats2 --------------------------------------------------------------------------
    r = con.execute("""
        WITH a AS (SELECT day, spotify_track_id, streams, mode_frequency, observation_count FROM track_day WHERE dataset='stats2' AND day <= DATE '2025-03-10'),
             b AS (SELECT day, spotify_track_id, streams, mode_frequency, observation_count FROM track_day WHERE dataset='stats')
        SELECT count(*) FILTER (WHERE a.day IS NULL) AS only_stats,
               count(*) FILTER (WHERE b.day IS NULL) AS only_stats2,
               count(*) FILTER (WHERE a.day IS NOT NULL AND b.day IS NOT NULL AND a.streams IS DISTINCT FROM b.streams) AS streams_differ,
               count(*) FILTER (WHERE a.day IS NOT NULL AND b.day IS NOT NULL AND
                    (a.streams IS DISTINCT FROM b.streams OR a.mode_frequency IS DISTINCT FROM b.mode_frequency
                     OR a.observation_count IS DISTINCT FROM b.observation_count)) AS any_differ,
               count(*) AS total
        FROM a FULL OUTER JOIN b ON a.day = b.day AND a.spotify_track_id = b.spotify_track_id""").fetchone()
    days = con.execute("""
        WITH a AS (SELECT day, spotify_track_id, streams, mode_frequency, observation_count FROM track_day WHERE dataset='stats2' AND day <= DATE '2025-03-10'),
             b AS (SELECT day, spotify_track_id, streams, mode_frequency, observation_count FROM track_day WHERE dataset='stats')
        SELECT DISTINCT coalesce(a.day, b.day) FROM a FULL OUTER JOIN b ON a.day = b.day AND a.spotify_track_id = b.spotify_track_id
        WHERE a.day IS NULL OR b.day IS NULL OR a.streams IS DISTINCT FROM b.streams
           OR a.mode_frequency IS DISTINCT FROM b.mode_frequency OR a.observation_count IS DISTINCT FROM b.observation_count
        ORDER BY 1""").fetchall()
    days = [str(x[0]) for x in days]
    res = {"rows_compared_union": r[4], "only_in_stats": r[0], "only_in_stats2": r[1],
           "rows_streams_differ": r[2], "rows_any_measure_differs": r[3], "differing_days": days}
    ck.add("stats vs stats2 track_day (days <= 2025-03-10): differing days must be a subset of {2025-03-10}",
           ["2025-03-10"], days, ok=set(days) <= {"2025-03-10"}, note=json.dumps(res))
    C.meta_set(con, "stats_vs_stats2_track_day", res)


# =================================================================================================
def build_isrc_day(con, ck: C.Checks) -> None:
    C.banner("derive: isrc_day")
    con.execute("DROP TABLE IF EXISTS isrc_day")
    con.execute("""
    CREATE TABLE isrc_day AS
    WITH base AS (
      SELECT dataset, day, isrc, spotify_track_id, streams, mode_frequency, observation_count,
             distinct_play_counts, mode_confidence
      FROM track_day WHERE isrc IS NOT NULL AND streams IS NOT NULL
    ), g AS (
      SELECT dataset, day, isrc, max(streams) AS streams, min(streams) AS min_streams,
             list(spotify_track_id ORDER BY spotify_track_id) AS source_ids, count(*)::BIGINT AS source_id_count
      FROM base GROUP BY dataset, day, isrc
    ), sel AS (
      SELECT * FROM (
        SELECT *, row_number() OVER (PARTITION BY dataset, day, isrc
                                     ORDER BY streams DESC, mode_confidence DESC NULLS LAST, spotify_track_id ASC) AS rn
        FROM base) WHERE rn = 1
    ), j AS (
      SELECT g.dataset, g.day, g.isrc, g.streams, g.source_ids, g.source_id_count,
             (g.streams <> g.min_streams) AS ids_disagree,
             sel.spotify_track_id AS selected_spotify_track_id,
             sel.mode_frequency, sel.observation_count, sel.distinct_play_counts, sel.mode_confidence
      FROM g JOIN sel USING (dataset, day, isrc)
    ), w AS (
      SELECT *, lag(day)     OVER (PARTITION BY dataset, isrc ORDER BY day) AS prev_day,
                lag(streams) OVER (PARTITION BY dataset, isrc ORDER BY day) AS prev_streams
      FROM j
    )
    SELECT dataset, day, isrc, streams, source_ids, source_id_count, ids_disagree, selected_spotify_track_id,
           mode_frequency, observation_count, distinct_play_counts, mode_confidence, prev_day,
           CASE WHEN prev_day = day - 1 AND streams - prev_streams >= 0 THEN streams - prev_streams END AS delta,
           COALESCE(prev_day = day - 1 AND streams - prev_streams < 0, FALSE) AS is_reset,
           CASE WHEN prev_day = day - 1 THEN streams - prev_streams END AS raw_delta
    FROM w ORDER BY dataset, isrc, day""")
    ck.info("isrc_day rows", con.execute("SELECT dataset, count(*) FROM isrc_day GROUP BY 1 ORDER BY 1").fetchall())

    # cross-check vs reconciliation canonical (stats2 only)
    r = con.execute(f"""
        WITH c AS (SELECT date AS day, isrc, streams_cumulative AS s, source_id_count AS n, source_spotify_ids AS ids,
                          selected_spotify_track_id AS sel, mode_frequency mf, observation_count oc, mode_confidence mc
                   FROM read_csv('{p(C.CANONICAL)}', header=true)),
             t AS (SELECT day, isrc, streams AS s, source_id_count AS n, array_to_string(source_ids, '|') AS ids,
                          selected_spotify_track_id AS sel, mode_frequency mf, observation_count oc, mode_confidence mc
                   FROM isrc_day WHERE dataset='stats2')
        SELECT count(*) FILTER (WHERE c.day IS NULL) AS only_ours,
               count(*) FILTER (WHERE t.day IS NULL) AS only_canonical,
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.s IS DISTINCT FROM t.s) AS streams_diff,
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.n IS DISTINCT FROM t.n) AS count_diff,
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.ids IS DISTINCT FROM t.ids) AS ids_diff,
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.sel IS DISTINCT FROM t.sel) AS selected_diff,
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.sel IS DISTINCT FROM t.sel
                                AND (c.mf IS DISTINCT FROM t.mf OR c.oc IS DISTINCT FROM t.oc)) AS selected_diff_with_stat_change,
               count(*) AS total,
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.sel IS DISTINCT FROM t.sel
                                AND abs(c.mc - t.mc) > 0.0000011) AS selected_diff_material_conf
        FROM c FULL OUTER JOIN t ON c.day = t.day AND c.isrc = t.isrc""").fetchone()
    ck.add("isrc_day[stats2] vs canonical: rows only in ours", 0, r[0])
    ck.add("isrc_day[stats2] vs canonical: rows only in canonical", 0, r[1])
    ck.add("isrc_day[stats2] vs canonical: streams_cumulative mismatches", 0, r[2], note=f"{r[7]:,} rows compared")
    ck.add("isrc_day[stats2] vs canonical: source_id_count mismatches", 0, r[3])
    ck.add("isrc_day[stats2] vs canonical: source id list mismatches", 0, r[4])
    ck.add("isrc_day[stats2] vs canonical: selected id differs AND mode_confidence differs by > 1e-6 (canonical stores it rounded to 6dp)", 0, r[8],
           note="remaining selected-id differences are exact ties in rounded confidence")
    ck.info("isrc_day[stats2] vs canonical: selected_spotify_track_id differs", r[5],
            note=f"tie-break noise (canonical rule: highest cumulative, then confidence, unknown last tie-break); "
                 f"of which with different mode_frequency/observation_count: {r[6]}")
    C.meta_set(con, "isrc_day_vs_canonical", {"only_ours": r[0], "only_canonical": r[1], "streams_diff": r[2],
                                              "source_id_count_diff": r[3], "source_ids_diff": r[4],
                                              "selected_id_diff": r[5], "selected_id_diff_with_stat_change": r[6],
                                              "rows_compared": r[7]})
    dis = con.execute("SELECT count(*) FILTER (WHERE ids_disagree), count(*) FILTER (WHERE source_id_count>1), count(*) FROM isrc_day WHERE dataset='stats2'").fetchone()
    ck.info("isrc_day[stats2] rows where merged ids disagree / have >1 id / total", list(dis))
    rs = con.execute("SELECT count(*) FILTER (WHERE is_reset), count(DISTINCT isrc) FILTER (WHERE is_reset) FROM isrc_day WHERE dataset='stats2'").fetchone()
    ck.info("isrc_day[stats2] reset rows / distinct isrcs with a reset", list(rs))


# =================================================================================================
def build_playlist_tables(con, ck: C.Checks) -> None:
    C.banner("derive: playlist_day (F2) + playlist_track_day")
    for t in ("playlist_day", "playlist_track_day"):
        con.execute(f"DROP TABLE IF EXISTS {t}")
    pd_parts, pt_parts = [], []
    for ds, cond in DATASETS:
        pd_parts.append(f"""
        SELECT '{ds}'::VARCHAR AS dataset, m.day, m.playlist_id, m.total_mode, m.mode_hours, h.hours_observed, t.tracks_observed
        FROM (
          SELECT day, playlist_id, tot AS total_mode, f AS mode_hours FROM (
            SELECT *, row_number() OVER (PARTITION BY playlist_id, day ORDER BY f DESC, tot DESC NULLS LAST) AS rn
            FROM (SELECT playlist_id, hour::DATE AS day, tot, count(*)::BIGINT AS f
                  FROM (SELECT playlist_id, date_trunc('hour', created_at) AS hour, sum(play_count)::BIGINT AS tot
                        FROM src_tracks WHERE {cond} GROUP BY 1, 2) GROUP BY 1, 2, 3)
          ) WHERE rn = 1) m
        JOIN (SELECT playlist_id, hour::DATE AS day, count(*)::BIGINT AS hours_observed
              FROM (SELECT DISTINCT playlist_id, date_trunc('hour', created_at) AS hour FROM src_tracks WHERE {cond})
              GROUP BY 1, 2) h USING (playlist_id, day)
        JOIN (SELECT playlist_id, created_at::DATE AS day, count(DISTINCT spotify_track_id)::BIGINT AS tracks_observed
              FROM src_tracks WHERE {cond} GROUP BY 1, 2) t USING (playlist_id, day)""")
        pt_parts.append(f"""
        SELECT '{ds}'::VARCHAR AS dataset, created_at::DATE AS day, playlist_id, spotify_track_id, count(*)::BIGINT AS observation_count
        FROM src_tracks WHERE {cond} GROUP BY 2, 3, 4""")
    with timed("playlist_day"):
        con.execute("CREATE TABLE playlist_day AS " + " UNION ALL ".join(pd_parts) + " ORDER BY dataset, playlist_id, day")
    with timed("playlist_track_day"):
        con.execute("CREATE TABLE playlist_track_day AS " + " UNION ALL ".join(pt_parts) +
                    " ORDER BY dataset, playlist_id, day, spotify_track_id")
    # Explorer playlist total: Σ F1 track-day modes of the tracks observed in the playlist that day.
    # Equal to the Grafana F2 value on ~95% of days (~98% within 0.1%), but immune to the collector
    # scraping a playlist twice in one hour, which doubles F2's hourly SUM (e.g. 2025-07-11).
    with timed("playlist_day.total_track_mode"):
        con.execute("""
        CREATE OR REPLACE TABLE playlist_day AS
        SELECT p.*, x.total_track_mode, x.tracks_with_mode
        FROM playlist_day p LEFT JOIN (
          SELECT pt.dataset, pt.day, pt.playlist_id, sum(t.streams)::BIGINT AS total_track_mode,
                 count(t.streams)::BIGINT AS tracks_with_mode
          FROM playlist_track_day pt JOIN track_day t
            ON t.dataset = pt.dataset AND t.day = pt.day AND t.spotify_track_id = pt.spotify_track_id
          GROUP BY ALL) x USING (dataset, day, playlist_id)
        ORDER BY dataset, playlist_id, day""")
    agree = con.execute("""SELECT count(*), count(*) FILTER (WHERE total_track_mode = total_mode),
        count(*) FILTER (WHERE abs(total_track_mode - total_mode) <= 0.001 * total_mode),
        count(*) FILTER (WHERE total_mode > 1.5 * total_track_mode OR total_mode < 0.67 * total_track_mode)
        FROM playlist_day WHERE dataset = 'stats2'""").fetchone()
    ck.info("playlist_day F2 vs sum of track modes (stats2): rows, exact, within 0.1%, gross (>1.5x / <0.67x)", list(agree))
    ck.info("playlist_day rows by dataset", con.execute("SELECT dataset, count(*) FROM playlist_day GROUP BY 1 ORDER BY 1").fetchall())
    ck.info("playlist_track_day rows by dataset", con.execute("SELECT dataset, count(*) FROM playlist_track_day GROUP BY 1 ORDER BY 1").fetchall())
    # internal consistency: tracks_observed == distinct ids in playlist_track_day
    bad = con.execute("""
        SELECT count(*) FROM playlist_day d JOIN (
           SELECT dataset, day, playlist_id, count(*) AS n FROM playlist_track_day GROUP BY ALL) x
        USING (dataset, day, playlist_id) WHERE d.tracks_observed <> x.n""").fetchone()[0]
    ck.add("playlist_day.tracks_observed == playlist_track_day distinct ids", 0, bad)
    nrows = con.execute("SELECT (SELECT count(*) FROM playlist_day), (SELECT count(*) FROM (SELECT DISTINCT dataset, playlist_id, day FROM playlist_track_day))").fetchone()
    ck.add("playlist_day rows == distinct (dataset,playlist,day) in playlist_track_day", nrows[1], nrows[0])
    # independent re-derivation of one playlist's F2 mode with plain SQL window functions (spot check)
    chk = con.execute("""
        WITH h AS (SELECT date_trunc('hour', created_at) hr, sum(play_count) tot FROM src_tracks WHERE playlist_id='0OwqBeZIh0JNJcIVobdtOz' GROUP BY 1),
             f AS (SELECT hr::DATE d, tot, count(*) c FROM h GROUP BY 1,2),
             m AS (SELECT d, arg_max(tot, (c, tot)) AS tot FROM f GROUP BY d)
        SELECT count(*) FROM m FULL OUTER JOIN (SELECT day d, total_mode FROM playlist_day WHERE dataset='stats2' AND playlist_id='0OwqBeZIh0JNJcIVobdtOz') p USING (d)
        WHERE m.tot IS DISTINCT FROM p.total_mode""").fetchone()[0]
    ck.add("playlist_day spot check (Releases playlist) vs independent arg_max formulation", 0, chk)

    # Strongest F2 proof: run the ORIGINAL Grafana SQL (Spotify Dash panel 75 'Releases + Extended: Total')
    # in the restored PostgreSQL and compare every day to SUM(total_mode) over the same two playlists.
    pg_sql = """
    WITH HourlyTotalCounts AS (
      SELECT DATE_TRUNC('hour', created_at) AS hour, playlist_id, SUM(play_count) AS hourly_total_count
      FROM tracks WHERE playlist_id IN ('0OwqBeZIh0JNJcIVobdtOz', '6Cbnl3B3t8mPcEXWskPjfw') GROUP BY hour, playlist_id),
    Frequencies AS (
      SELECT DATE_TRUNC('day', hour) AS day, playlist_id, hourly_total_count, COUNT(*) AS freq
      FROM HourlyTotalCounts GROUP BY day, playlist_id, hourly_total_count),
    MaxFreq AS (
      SELECT day, playlist_id, hourly_total_count FROM (
        SELECT day, playlist_id, hourly_total_count, freq,
               ROW_NUMBER() OVER(PARTITION BY day, playlist_id ORDER BY freq DESC, hourly_total_count DESC) AS rnum
        FROM Frequencies) sq WHERE rnum = 1)
    SELECT day::date AS day, SUM(hourly_total_count)::bigint AS total_stream_count FROM MaxFreq GROUP BY day ORDER BY day"""
    with C.pg_connect("stats2") as pg:
        pg_rows = pg.execute(pg_sql).fetchall()
    mine = con.execute("""SELECT day, sum(total_mode)::BIGINT FROM playlist_day
                          WHERE dataset='stats2' AND playlist_id IN ('0OwqBeZIh0JNJcIVobdtOz','6Cbnl3B3t8mPcEXWskPjfw')
                          GROUP BY day ORDER BY day""").fetchall()
    a_ = {d: int(v) for d, v in pg_rows}
    b_ = {d: int(v) for d, v in mine}
    ndiff = len(set(a_) ^ set(b_)) + sum(1 for d in set(a_) & set(b_) if a_[d] != b_[d])
    ck.add("playlist_day vs ORIGINAL Grafana SQL run in PostgreSQL (panel 75, Releases+Extended total): differing days", 0, ndiff,
           note=f"{len(pg_rows)} days compared")


# =================================================================================================
def build_catalog_day(con, ck: C.Checks) -> None:
    C.banner("derive: catalog_day")
    con.execute("DROP TABLE IF EXISTS catalog_day")
    con.execute("""
    CREATE TABLE catalog_day AS
    WITH a AS (
      SELECT dataset, day, count(*)::BIGINT AS tracks, sum(streams)::BIGINT AS streams,
             sum(delta)::BIGINT AS daily_net_raw, count(delta)::BIGINT AS tracks_with_delta,
             (count(*) FILTER (WHERE is_reset))::BIGINT AS resets,
             (count(*) FILTER (WHERE prev_day IS NULL OR prev_day <> day - 1))::BIGINT AS missing_prev
      FROM isrc_day GROUP BY dataset, day)
    SELECT dataset, day, tracks, streams,
           CASE WHEN missing_prev * 10 > tracks THEN NULL ELSE daily_net_raw END AS daily_net,
           daily_net_raw, tracks_with_delta, resets, missing_prev,
           missing_prev::DOUBLE / tracks AS missing_prev_share,
           (missing_prev * 10 > tracks) AS low_coverage
    FROM a ORDER BY dataset, day""")
    # A day's catalog total is only meaningful when (nearly) every ISRC being tracked at the time was
    # read. Coverage is bimodal (stats2: 845 days >= 95%, 18 days <= 65%, e.g. 2025-07-05..09 had 9 of
    # 2,418 tracks), so days under 90% keep `streams` (raw partial sum) but get streams_complete = NULL.
    con.execute("""
    CREATE OR REPLACE TABLE catalog_day AS
    WITH span AS (SELECT dataset, isrc, min(day) AS f, max(day) AS l FROM isrc_day GROUP BY ALL),
         e AS (SELECT c.dataset, c.day, count(s.isrc)::BIGINT AS expected_tracks
               FROM catalog_day c JOIN span s ON s.dataset = c.dataset AND c.day BETWEEN s.f AND s.l GROUP BY ALL)
    SELECT c.*, e.expected_tracks, c.tracks::DOUBLE / e.expected_tracks AS coverage_share,
           (c.tracks < 0.9 * e.expected_tracks) AS is_partial,
           CASE WHEN c.tracks >= 0.9 * e.expected_tracks THEN c.streams END AS streams_complete
    FROM catalog_day c JOIN e USING (dataset, day) ORDER BY dataset, day""")
    ck.info("catalog_day partial days (<90% of tracked ISRCs read) by dataset",
            con.execute("SELECT dataset, count(*) FILTER (WHERE is_partial), count(*) FROM catalog_day GROUP BY 1 ORDER BY 1").fetchall())
    ck.info("catalog_day rows by dataset", con.execute("SELECT dataset, count(*) FROM catalog_day GROUP BY 1 ORDER BY 1").fetchall())
    r = con.execute(f"""
        WITH c AS (SELECT date AS day, track_count, total_streams_cumulative AS s, daily_streams_net AS net,
                          reset_track_count AS rs, missing_previous_track_count AS mp
                   FROM read_csv('{p(C.CATALOG_CSV)}', header=true)),
             t AS (SELECT * FROM catalog_day WHERE dataset='stats2')
        SELECT count(*) FILTER (WHERE c.day IS NULL), count(*) FILTER (WHERE t.day IS NULL),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.track_count <> t.tracks),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.s <> t.streams),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.rs <> t.resets),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.mp <> t.missing_prev),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.net IS DISTINCT FROM t.daily_net),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.net IS DISTINCT FROM t.daily_net_raw),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.net IS NULL AND t.daily_net IS NOT NULL),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.net IS NOT NULL AND t.daily_net IS NULL),
               count(*) FILTER (WHERE c.day IS NOT NULL AND t.day IS NOT NULL AND c.net IS NOT NULL AND t.daily_net IS NOT NULL AND c.net <> t.daily_net),
               count(*)
        FROM c FULL OUTER JOIN t ON c.day = t.day""").fetchone()
    ck.add("catalog_day[stats2] vs legacy_catalog_daily_stats.csv: days only in ours", 0, r[0])
    ck.add("catalog_day[stats2] vs catalog csv: days only in csv", 0, r[1])
    ck.add("catalog_day[stats2] vs catalog csv: track_count mismatches", 0, r[2])
    ck.add("catalog_day[stats2] vs catalog csv: total_streams mismatches", 0, r[3])
    ck.add("catalog_day[stats2] vs catalog csv: reset_track_count mismatches", 0, r[4])
    ck.add("catalog_day[stats2] vs catalog csv: missing_previous mismatches", 0, r[5])
    ck.info("catalog_day[stats2] vs catalog csv: daily_net differs (masked rule)", r[6],
            note=f"csv has net where we mask (>10% missing prev): {r[9]}; we have net where csv is NULL: {r[8]}; both non-null but different value: {r[10]}; differs from UNMASKED sum: {r[7]}")
    C.meta_set(con, "catalog_day_vs_csv", {"days_only_ours": r[0], "days_only_csv": r[1], "track_count_diff": r[2],
                                           "streams_diff": r[3], "resets_diff": r[4], "missing_prev_diff": r[5],
                                           "daily_net_diff_masked": r[6], "daily_net_diff_unmasked": r[7],
                                           "csv_has_net_we_mask": r[9], "we_have_net_csv_null": r[8],
                                           "both_nonnull_but_different": r[10], "days_compared": r[11]})
    ex = con.execute(f"""
        WITH c AS (SELECT date AS day, daily_streams_net AS net, missing_previous_track_count AS mp FROM read_csv('{p(C.CATALOG_CSV)}', header=true))
        SELECT t.day, c.net, t.daily_net_raw, t.daily_net, t.tracks, t.missing_prev
        FROM c JOIN catalog_day t ON t.dataset='stats2' AND c.day = t.day
        WHERE c.net IS DISTINCT FROM t.daily_net ORDER BY t.day LIMIT 8""").fetchall()
    ck.info("catalog_day diff examples (day, csv_net, our_raw, our_masked, tracks, missing_prev)", [[str(x) for x in e] for e in ex])


# =================================================================================================
def build_identity(con, ck: C.Checks) -> None:
    C.banner("derive: track_identity / isrc_identity")
    for t in ("track_identity", "isrc_identity"):
        con.execute(f"DROP TABLE IF EXISTS {t}")
    with timed("track_identity"):
        con.execute("""
        CREATE TABLE track_identity AS
        WITH nm AS (
          SELECT spotify_track_id,
                 list(struct_pack(song_name := song_name, artist := artist, first_day := fd, last_day := ld, observations := n)
                      ORDER BY fd, song_name, artist) AS names_seen
          FROM (SELECT spotify_track_id, song_name, artist, min(created_at)::DATE AS fd, max(created_at)::DATE AS ld, count(*)::BIGINT AS n
                FROM src_tracks GROUP BY 1, 2, 3) GROUP BY 1),
        t AS (
          SELECT spotify_track_id,
                 arg_max(song_name, (created_at, id)) AS song_name,
                 arg_max(artist, (created_at, id)) AS artist,
                 list_sort(list(DISTINCT song_name)) AS song_names,
                 list_sort(list(DISTINCT artist)) AS artists,
                 list_sort(list(DISTINCT playlist_id)) AS playlists,
                 min(created_at)::DATE AS first_day, max(created_at)::DATE AS last_day,
                 min(created_at) AS first_obs, max(created_at) AS last_obs,
                 count(*)::BIGINT AS total_observations,
                 (count(*) FILTER (WHERE in_stats_dump))::BIGINT AS observations_stats
          FROM src_tracks GROUP BY spotify_track_id)
        SELECT t.spotify_track_id, m.isrc, t.song_name, t.artist, t.song_names, t.artists, nm.names_seen, t.playlists,
               t.first_day, t.last_day, t.first_obs, t.last_obs, t.total_observations, t.observations_stats
        FROM t JOIN nm USING (spotify_track_id) LEFT JOIN isrc_map m USING (spotify_track_id)
        ORDER BY t.spotify_track_id""")
    with timed("isrc_identity"):
        con.execute("""
        CREATE TABLE isrc_identity AS
        WITH ti AS (SELECT * FROM track_identity WHERE isrc IS NOT NULL),
        latest AS (SELECT isrc, arg_max(streams, day) AS latest_streams, max(day) AS latest_streams_day
                   FROM isrc_day WHERE dataset='stats2' GROUP BY isrc),
        pl AS (SELECT isrc, list_sort(list(DISTINCT p)) AS playlists FROM (SELECT isrc, unnest(playlists) AS p FROM ti) GROUP BY isrc)
        SELECT ti.isrc,
               arg_max(ti.song_name, (ti.last_obs, ti.spotify_track_id)) AS song_name,
               arg_max(ti.artist, (ti.last_obs, ti.spotify_track_id)) AS artist,
               arg_max(ti.spotify_track_id, (ti.last_obs, ti.spotify_track_id)) AS display_spotify_track_id,
               list_sort(list(ti.spotify_track_id)) AS spotify_track_ids,
               count(*)::BIGINT AS id_count,
               any_value(pl.playlists) AS playlists,
               min(ti.first_day) AS first_day, max(ti.last_day) AS last_day,
               sum(ti.total_observations)::BIGINT AS total_observations,
               any_value(latest.latest_streams) AS latest_streams, any_value(latest.latest_streams_day) AS latest_streams_day
        FROM ti JOIN pl USING (isrc) LEFT JOIN latest USING (isrc)
        GROUP BY ti.isrc ORDER BY ti.isrc""")
    a = con.execute("SELECT (SELECT count(*) FROM track_identity), (SELECT count(*) FROM isrc_identity), (SELECT count(*) FROM track_identity WHERE isrc IS NULL)").fetchone()
    ck.info("track_identity rows / isrc_identity rows / track_identity rows without isrc", list(a))
    ck.add("isrc_identity rows == distinct isrcs", C.EXPECT_ISRCS, a[1])
    nn = con.execute("SELECT count(*) FROM track_identity WHERE array_length(song_names) > 1 OR array_length(artists) > 1").fetchone()[0]
    ck.info("track_identity ids that appear under more than one song_name/artist spelling", nn)


# =================================================================================================
# playlists (names ONLY from dashboard definitions)
# =================================================================================================
def strip_sql_comments(sql: str) -> str:
    out, i, n, q = [], 0, len(sql), False
    while i < n:
        c = sql[i]
        if q:
            out.append(c)
            if c == "'":
                if i + 1 < n and sql[i + 1] == "'":
                    out.append("'")
                    i += 1
                else:
                    q = False
        elif c == "'":
            q = True
            out.append(c)
        elif c == "-" and sql.startswith("--", i):
            while i < n and sql[i] not in "\r\n":
                i += 1
            continue
        elif c == "/" and sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        else:
            out.append(c)
        i += 1
    return "".join(out)


def read_literal(s: str, i: int):
    """read a '...' SQL literal starting at s[i] (after optional whitespace). returns (value, next_pos) or (None, i)."""
    n = len(s)
    while i < n and s[i] in " \t\r\n":
        i += 1
    if i >= n or s[i] != "'":
        return None, i
    i += 1
    buf = []
    while i < n:
        if s[i] == "'":
            if i + 1 < n and s[i + 1] == "'":
                buf.append("'")
                i += 2
                continue
            return "".join(buf), i + 1
        buf.append(s[i])
        i += 1
    return None, i


FILTER_RE = re.compile(r"\b(playlist_id|playlist_name|account_name)\s*(=|\bIN\b)\s*", re.I)
TRIPLE_RE = re.compile(r"\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*\d+\s*\)")
PAIR_RE = re.compile(r"\(\s*'([0-9A-Za-z]{22})'\s*,\s*'((?:[^']|'')*)'\s*\)")


def extract_filters(sql: str) -> dict[str, set[str]]:
    s = strip_sql_comments(sql)
    out: dict[str, set[str]] = defaultdict(set)
    for m in FILTER_RE.finditer(s):
        col, op = m.group(1).lower(), m.group(2).lower()
        pos = m.end()
        if op == "=":
            lit, _ = read_literal(s, pos)
            if lit is not None:
                out[col].add(lit)
        else:
            while pos < len(s) and s[pos] in " \t\r\n":
                pos += 1
            if pos < len(s) and s[pos] == "(":
                pos += 1
                while True:
                    lit, pos2 = read_literal(s, pos)
                    if lit is None:
                        break
                    out[col].add(lit)
                    pos = pos2
                    while pos < len(s) and s[pos] in " \t\r\n":
                        pos += 1
                    if pos < len(s) and s[pos] == ",":
                        pos += 1
                        continue
                    break
    return out


def grafana_dashboards(path: Path) -> dict[str, dict]:
    """dashboard title -> parsed JSON model. Opened read-only/immutable; only the `dashboard` table is read."""
    uri = "file:" + Path(path).as_posix() + "?mode=ro&immutable=1"
    db = sqlite3.connect(uri, uri=True)
    try:
        return {t: json.loads(d) for t, d in db.execute("SELECT title, data FROM dashboard")}
    finally:
        db.close()


def walk_panels(panels, row=None):
    for pn in panels:
        if pn.get("type") == "row":
            yield pn, row
            if pn.get("panels"):
                yield from walk_panels(pn["panels"], pn.get("title"))
        else:
            yield pn, row


def panel_sqls(pn) -> list[str]:
    return [t.get("rawSql") for t in pn.get("targets", []) if t.get("rawSql")]


def build_playlists(con, ck: C.Checks) -> None:
    C.banner("derive: playlists (names from dashboard definitions only)")
    con.execute("DROP TABLE IF EXISTS playlists")
    dash = grafana_dashboards(C.GRAFANA_STATS2)
    cands: dict[str, list[tuple[int, str, str]]] = defaultdict(list)  # id -> [(rank, name, source)]
    groups: dict[str, set[str]] = defaultdict(set)
    persons: dict[str, set[str]] = defaultdict(set)
    ID22 = re.compile(r"^[0-9A-Za-z]{22}$")

    # --- Tax V2 custom variables ---------------------------------------------------------------
    tax = dash["Tax V2"]
    var = {v["name"]: v for v in tax["templating"]["list"]}
    for entry in var["playlist_id"]["query"].split(","):
        if ":" not in entry:
            continue
        label, val = entry.split(":", 1)
        label, val = label.strip(), val.strip()
        for pid in [x.strip() for x in val.split(";") if x.strip()]:
            if ID22.match(pid):
                cands[pid].append((1, label, "Tax V2 variable playlist_id"))
                groups[pid].add(f"Tax V2 playlist: {label}")
    for entry in var["person"]["query"].split(","):
        if ":" not in entry:
            continue
        label, val = entry.split(":", 1)
        label = label.strip()
        for pid in [x.strip() for x in val.split(";") if x.strip()]:
            if ID22.match(pid):
                groups[pid].add(f"Tax V2 person: {label}")
                persons[pid].add(label)
    # --- Spotify Dash panel titles -------------------------------------------------------------
    sd = dash["Spotify Dash"]
    for pn, row in walk_panels(sd["panels"]):
        for sql in panel_sqls(pn):
            f = extract_filters(sql)
            ids = sorted(f.get("playlist_id", set()))
            if not ids:
                continue
            title = re.sub(r"\s*:\s*(Total|Daily|Avg Daily)$", "", pn["title"].strip())
            for pid in ids:
                groups[pid].add(f"Spotify Dash: {title}")
                if len(ids) == 1 and row in ("Individual Playlists", "Monthly Data"):
                    cands[pid].append((2, title, f"Spotify Dash panel title ({row})"))
            break
    # --- VALUES ('id','name') mappings in Tax V2 / Tax (Old) panel SQL ---------------------------
    for dname in ("Tax V2", "Tax (Old)"):
        for pn, row in walk_panels(dash[dname]["panels"]):
            for sql in panel_sqls(pn):
                for m in PAIR_RE.finditer(strip_sql_comments(sql)):
                    if ID22.match(m.group(2).strip()):  # a pair of ids, not (id, name)
                        continue
                    cands[m.group(1)].append((3, m.group(2).replace("''", "'").strip(), f"{dname} panel SQL VALUES mapping"))
    # --- Tax V2 'Playlists Per Person' text panel --------------------------------------------------
    for pn, row in walk_panels(tax["panels"]):
        if pn.get("type") == "text" and pn.get("title") == "Playlists Per Person":
            for line in pn.get("options", {}).get("content", "").splitlines():
                m = re.match(r"^\s*(.+?)\s*:\s*([0-9A-Za-z]{22})\s*$", line)
                if m:
                    cands[m.group(2)].append((4, m.group(1).strip(), "Tax V2 text panel 'Playlists Per Person'"))

    # --- final records ---------------------------------------------------------------------------
    live = con.execute("""SELECT playlist_id, min(created_at)::DATE, max(created_at)::DATE, count(*), count(DISTINCT spotify_track_id)
                          FROM src_tracks GROUP BY 1 ORDER BY 1""").fetchall()
    rows, conflicts, unnamed = [], [], []
    for pid, fd, ld, n, ntr in live:
        cs = sorted(set(cands.get(pid, [])), key=lambda c: (c[0], c[1]))
        names, seen = [], set()
        for _, nm, _s in cs:
            if nm and nm not in seen:
                seen.add(nm)
                names.append(nm)
        name = cs[0][1] if cs else None
        norm_names = {re.sub(r"\s+", " ", n.casefold()) for n in names}
        conflict = len(norm_names) > 1
        if conflict:
            conflicts.append({"playlist_id": pid, "chosen": name, "variants": [(c[1], c[2]) for c in cs]})
        if name is None:
            unnamed.append(pid)
        short = min(names, key=lambda x: (len(x), x)) if names else None
        pers = sorted(persons.get(pid, set()))
        non_acc = [x for x in pers if x != "Acc"]
        owner = non_acc[0] if len(non_acc) == 1 else None
        rows.append((pid, name, short, owner, pers, sorted(groups.get(pid, set())), names,
                     cs[0][2] if cs else None,
                     json.dumps([{"name": c[1], "source": c[2]} for c in cs]), conflict,
                     str(fd), str(ld), n, ntr))
    con.execute("""CREATE TABLE playlists(
        playlist_id VARCHAR PRIMARY KEY, name VARCHAR, short_name VARCHAR, owner VARCHAR, persons VARCHAR[],
        groups VARCHAR[], names VARCHAR[], name_source VARCHAR, name_candidates JSON, name_conflict BOOLEAN,
        first_day DATE, last_day DATE, observations BIGINT, tracks BIGINT)""")
    con.executemany("INSERT INTO playlists VALUES (?,?,?,?,?,?,?,?,?::JSON,?,?::DATE,?::DATE,?,?)", rows)
    ck.add("playlists rows == distinct src_tracks playlist_id", len(live), con.execute("SELECT count(*) FROM playlists").fetchone()[0])
    ck.info("playlists without a dashboard-defined name (name left NULL)", unnamed,
            note="never invented; only referenced by Spotify Dash 'Test' hourly panel (group) if listed")
    ck.info("playlists with conflicting dashboard names (chosen by precedence variable>Spotify Dash>VALUES>text)", len(conflicts))
    live_ids = {r[0] for r in live}
    dash_only = sorted(pid for pid in cands if pid not in live_ids)
    ck.info("dashboard-defined playlist ids with no rows in src_tracks", {pid: sorted({c[1] for c in cands[pid]}) for pid in dash_only})
    C.meta_set(con, "playlist_name_conflicts", conflicts)
    C.meta_set(con, "playlists_unnamed", unnamed)
    C.meta_set(con, "playlist_ids_in_dashboards_without_data", {pid: sorted({c[1] for c in cands[pid]}) for pid in dash_only})
    C.meta_set(con, "playlist_name_precedence", ["Tax V2 variable playlist_id (query string, not stale options)",
                                                 "Spotify Dash panel titles (rows Individual Playlists / Monthly Data, single-id panels)",
                                                 "Tax V2/Tax (Old) panel SQL VALUES ('id','name')",
                                                 "Tax V2 text panel 'Playlists Per Person'"])


# =================================================================================================
def build_pf(con, ck: C.Checks) -> None:
    C.banner("derive: pf_playlist_day / pf_playlists")
    for t in ("pf_playlist_day", "pf_playlists"):
        con.execute(f"DROP TABLE IF EXISTS {t}")
    with timed("pf_playlist_day"):
        con.execute("""
        CREATE TABLE pf_playlist_day AS
        WITH r AS (
          SELECT *, "timestamp"::DATE AS day,
                 row_number() OVER (PARTITION BY playlist_id, "timestamp"::DATE
                                    ORDER BY "timestamp" DESC, followers DESC NULLS LAST, account_name, user_id, playlist_name) AS rn
          FROM pf_followers)
        SELECT day, playlist_id,
               max(followers) AS followers_max,
               max(followers) FILTER (WHERE rn = 1) AS followers_last,
               count(*)::BIGINT AS readings,
               (count(*) FILTER (WHERE followers = 0))::BIGINT AS zero_readings,
               (count(*) FILTER (WHERE followers IS NULL))::BIGINT AS null_readings,
               max("timestamp") AS last_reading_at,
               max(account_name) FILTER (WHERE rn = 1) AS account_name,
               max(playlist_name) FILTER (WHERE rn = 1) AS playlist_name
        FROM r GROUP BY day, playlist_id ORDER BY playlist_id, day""")
    # Explorer value: most frequent reading of the day (tie -> higher), the owner's "commonly
    # occurring reading is truth" rule. Grafana's MAX is fooled by misattributed readings, e.g. on
    # 2025-01-09 ~16:00 UTC the collector stored rows under neighbouring playlists (139 inflated days).
    with timed("pf_playlist_day.followers_mode"):
        con.execute("""
        CREATE OR REPLACE TABLE pf_playlist_day AS
        SELECT p.*, m.followers_mode, m.mode_frequency
        FROM pf_playlist_day p LEFT JOIN (
          SELECT playlist_id, day, arg_max(followers, (f, followers)) AS followers_mode, max(f)::BIGINT AS mode_frequency
          FROM (SELECT playlist_id, "timestamp"::DATE AS day, followers, count(*) AS f
                FROM pf_followers WHERE followers IS NOT NULL GROUP BY ALL)
          GROUP BY ALL) m USING (playlist_id, day)
        ORDER BY playlist_id, day""")
    mm = con.execute("""SELECT count(*), count(*) FILTER (WHERE followers_mode = followers_max),
        count(*) FILTER (WHERE followers_max > followers_mode * 1.05 AND followers_max - followers_mode > 100)
        FROM pf_playlist_day""").fetchone()
    ck.info("pf_playlist_day rows / mode==max / max inflated >5% & >100", list(mm))
    n = con.execute("SELECT count(*), count(DISTINCT playlist_id) FROM pf_playlist_day").fetchone()
    ck.info("pf_playlist_day rows / playlists", list(n))

    # --- dashboard groups from the Playlist followers grafana.db --------------------------------------
    pf_dash = grafana_dashboards(C.GRAFANA_PF)
    d = next(iter(pf_dash.values()))
    triples = con.execute("SELECT DISTINCT playlist_id, playlist_name, account_name FROM pf_followers").fetchall()
    pf_ids = {t[0] for t in triples}
    target_rows = ["Ads Running (Usual)", "Ads Stopped (Usual)", f"Ads Running ({C.required_env('LEGACY_FOLLOWER_GROUP')})", f"Ads Stopped ({C.required_env('LEGACY_FOLLOWER_GROUP')})",
                   "Ads Running (JB)", "Ads Stopped (JB)", "K Request"]
    grp: dict[str, set[str]] = defaultdict(set)
    stats = {"panels_seen": 0, "panels_with_filter": 0, "panels_values_table": 0, "resolved": 0,
             "ambiguous_name_account_to_multiple_ids": 0, "unresolved": 0, "by_filter_kind": defaultdict(int)}
    unresolved = []
    ambiguous = []

    def resolve(f: dict[str, set[str]]):
        return sorted({pid for pid, nm, ac in triples
                       if (not f.get("playlist_id") or pid in f["playlist_id"])
                       and (not f.get("playlist_name") or nm in f["playlist_name"])
                       and (not f.get("account_name") or ac in f["account_name"])})

    for pn, row in walk_panels(d["panels"]):
        if row not in target_rows:
            continue
        stats["panels_seen"] += 1
        for sql in panel_sqls(pn):
            clean = strip_sql_comments(sql)
            f = extract_filters(sql)
            if f:
                stats["panels_with_filter"] += 1
                kind = "+".join(k for k in ("playlist_id", "playlist_name", "account_name") if f.get(k))
                stats["by_filter_kind"][kind] += 1
                ids = resolve(f)
                missing_ids = [x for x in f.get("playlist_id", set()) if x not in pf_ids]
                if ids and not missing_ids:
                    stats["resolved"] += 1
                    if f.get("playlist_name") and f.get("account_name") and len(ids) > 1 and len(f["playlist_name"]) == 1:
                        stats["ambiguous_name_account_to_multiple_ids"] += 1
                        ambiguous.append({"row": row, "panel": pn.get("title"), "ids": ids})
                    for pid in ids:
                        grp[pid].add(row)
                else:
                    stats["unresolved"] += 1
                    unresolved.append({"row": row, "panel": pn.get("title"), "filter": {k: sorted(v) for k, v in f.items()}})
            elif pn.get("type") == "table" and TRIPLE_RE.search(clean):
                stats["panels_values_table"] += 1
                for m in TRIPLE_RE.finditer(clean):
                    nm, ac = m.group(1).replace("''", "'"), m.group(2).replace("''", "'")
                    ids = [pid for pid, n_, a_ in triples if n_ == nm and a_ == ac]
                    if ids:
                        stats["resolved"] += 1
                        for pid in ids:
                            grp[pid].add(row)
                    else:
                        stats["unresolved"] += 1
                        unresolved.append({"row": row, "panel": pn.get("title"), "values": [nm, ac]})
    stats["by_filter_kind"] = dict(stats["by_filter_kind"])
    ck.info("PF dashboard group extraction (panel counts)", stats)
    ck.info("PF dashboard panels whose literals matched no pf_followers playlist (unresolved)", len(unresolved))
    C.meta_set(con, "pf_dashboard_groups", {"stats": stats, "unresolved": unresolved[:100], "ambiguous": ambiguous[:100],
                                            "note": "Spec said playlist_id literals; the panels overwhelmingly filter by playlist_name/account_name, "
                                                    "so (name, account) literals were resolved to playlist_id(s) through pf_followers."})
    with timed("pf_playlists"):
        con.execute("""
        CREATE TABLE pf_playlists AS
        WITH r AS (
          SELECT *, row_number() OVER (PARTITION BY playlist_id ORDER BY "timestamp" DESC, followers DESC NULLS LAST,
                                       account_name NULLS LAST, user_id NULLS LAST, playlist_name) AS rn
          FROM pf_followers),
        agg AS (
          SELECT playlist_id,
                 list_sort(list(DISTINCT playlist_name)) AS playlist_names,
                 list_sort(list(DISTINCT account_name)) AS account_names,
                 min("timestamp") AS first_reading, max("timestamp") AS last_reading,
                 count(*)::BIGINT AS readings,
                 arg_max(account_name, ("timestamp", account_name)) FILTER (WHERE account_name IS NOT NULL) AS account_name,
                 arg_max(user_id, ("timestamp", user_id)) FILTER (WHERE user_id IS NOT NULL) AS user_id
          FROM pf_followers GROUP BY playlist_id),
        lat AS (SELECT playlist_id, playlist_name AS name, followers AS latest_followers FROM r WHERE rn = 1)
        SELECT a.playlist_id, lat.name, a.playlist_names, a.account_name, a.account_names, a.user_id,
               a.first_reading, a.last_reading, lat.latest_followers, a.readings
        FROM agg a JOIN lat USING (playlist_id) ORDER BY a.playlist_id""")
    con.execute("ALTER TABLE pf_playlists ADD COLUMN dashboard_groups VARCHAR[]")
    con.executemany("UPDATE pf_playlists SET dashboard_groups = ? WHERE playlist_id = ?",
                    [(sorted(g), pid) for pid, g in grp.items()])
    con.execute("UPDATE pf_playlists SET dashboard_groups = [] WHERE dashboard_groups IS NULL")
    ck.add("pf_playlists rows", 905, con.execute("SELECT count(*) FROM pf_playlists").fetchone()[0])
    ck.info("pf_playlists with at least one dashboard group", con.execute("SELECT count(*) FROM pf_playlists WHERE len(dashboard_groups) > 0").fetchone()[0])


# =================================================================================================
def build_views(con, ck: C.Checks) -> None:
    C.banner("derive: grafana / grafana_stats views")
    for s in ("grafana", "grafana_stats"):
        con.execute(f"DROP SCHEMA IF EXISTS {s} CASCADE")
        con.execute(f"CREATE SCHEMA {s}")
    tcols = "id, playlist_id, spotify_track_id, song_name, artist, play_count, created_at"
    mcols = "id, song_name, artist, play_count, milestone, created_at"
    con.execute(f"CREATE VIEW grafana.tracks AS SELECT {tcols} FROM main.src_tracks")
    con.execute(f"CREATE VIEW grafana.milestones AS SELECT {mcols} FROM main.src_milestones")
    con.execute("CREATE VIEW grafana.artists AS SELECT artist_name FROM main.src_artists")
    con.execute("CREATE VIEW grafana.songs_by_artist AS SELECT artist, song_name FROM main.src_songs_by_artist")
    con.execute("CREATE VIEW grafana.spotify_followers AS SELECT playlist_name, followers, account_name, user_id, playlist_id, \"timestamp\" FROM main.pf_followers")
    con.execute(f"CREATE VIEW grafana_stats.tracks AS SELECT {tcols} FROM main.src_tracks WHERE in_stats_dump")
    con.execute(f"CREATE VIEW grafana_stats.milestones AS SELECT {mcols} FROM main.src_milestones WHERE in_stats_dump")
    a = con.execute("SELECT (SELECT count(*) FROM grafana.tracks), (SELECT count(*) FROM grafana_stats.tracks), "
                    "(SELECT count(*) FROM grafana.milestones), (SELECT count(*) FROM grafana_stats.milestones), "
                    "(SELECT count(*) FROM grafana.spotify_followers)").fetchone()
    ck.add("views row counts (grafana.tracks, grafana_stats.tracks, grafana.milestones, grafana_stats.milestones, grafana.spotify_followers)",
           [34325689, 27198862, 15705, 10543, 2710108], list(a))


# =================================================================================================
def write_meta(con, ck: C.Checks, t_start: float) -> None:
    counts = {}
    for t in ["src_tracks", "src_milestones", "src_artists", "src_songs_by_artist", "pf_followers"] + DERIVED_TABLES:
        counts[t] = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    C.meta_set(con, "row_counts", counts)
    C.meta_set(con, "dataset_row_counts", {
        t: dict(con.execute(f"SELECT dataset, count(*) FROM {t} GROUP BY 1 ORDER BY 1").fetchall())
        for t in ("track_day", "isrc_day", "playlist_day", "playlist_track_day", "catalog_day")})
    rng = {}
    for t, col in (("track_day", "day"), ("isrc_day", "day"), ("playlist_day", "day"), ("catalog_day", "day")):
        rng[t] = {ds: [str(a), str(b)] for ds, a, b in con.execute(f"SELECT dataset, min({col}), max({col}) FROM {t} GROUP BY 1 ORDER BY 1").fetchall()}
    rng["pf_playlist_day"] = [str(x) for x in con.execute("SELECT min(day), max(day) FROM pf_playlist_day").fetchone()]
    C.meta_set(con, "date_ranges", rng)
    C.meta_set(con, "build", {"built_at": C.now_iso(), "script_version": C.SCRIPT_VERSION,
                              "derive_seconds": round(time.time() - t_start, 1),
                              "tool_versions": {"python": sys.version.split()[0], "duckdb": con.execute("select version()").fetchone()[0]},
                              "day_definition": "UTC calendar day (DATE(created_at)); source timestamps are naive UTC",
                              "datasets": {"stats2": "all src_tracks rows", "stats": "rows with in_stats_dump (stats server subset; last day 2025-03-10 partial)"}})
    C.meta_set(con, "derive_verification", [
        {"name": c.name, "passed": c.passed, "expected": c.expected, "actual": c.actual, "note": c.note, "info": c.info}
        for c in ck.items])


def main() -> int:
    t0 = time.time()
    ck = C.Checks("derive")
    if not C.OUT_DB.exists():
        print("legacy_archive.duckdb missing - run export_raw.py first", file=sys.stderr)
        return 2
    con = C.duck_connect(C.OUT_DB)
    build_isrc_map(con, ck)
    build_track_day(con, ck)
    build_isrc_day(con, ck)
    build_playlist_tables(con, ck)
    build_catalog_day(con, ck)
    build_identity(con, ck)
    build_playlists(con, ck)
    build_pf(con, ck)
    build_views(con, ck)
    write_meta(con, ck, t0)
    con.execute("CHECKPOINT")
    con.close()
    print(f"  derive total {time.time() - t0:.0f}s", flush=True)
    return ck.finish()


if __name__ == "__main__":
    sys.exit(main())
