"""One-off loader: recovered 2023-07..2025-12 own-catalog stream history -> compact tier.

Source: DuckDB copy of the Legacy Archive Viewer data (dataset 'stats2' only).
Target: public.track_streams_monthly (packed vals[], index = day of month, NULL = missing)
        and public.legacy_catalog_daily_stats (Home "Archived history").

Modes: load (default) | verify (exact round trip vs DuckDB, both directions).
Usage: python scripts/load_legacy_stream_history.py --duckdb legacy_archive.duckdb [--verify]
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never printed).
Idempotent: upserts on (isrc, month) / (date). Refuses months >= 2026-01-01 (live tier).
"""
import argparse
import calendar
import os
import sys
from collections import defaultdict
from datetime import date

import duckdb

sys.path.insert(0, os.path.dirname(__file__))
from streambase_postgrest import Postgrest  # noqa: E402

LIVE_FLOOR = date(2026, 1, 1)


def load_env():
    p = os.path.join(os.path.dirname(__file__), "..", "web", ".env.local")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def source_rows(con):
    return con.execute(
        "select day, isrc, streams from isrc_day where dataset='stats2' order by isrc, day"
    ).fetchall()


def build_months(rows):
    m = {}
    for d, isrc, s in rows:
        if d >= LIVE_FLOOR:
            raise SystemExit(f"refusing live-tier date {d}")
        key = (isrc, d.replace(day=1))
        arr = m.get(key)
        if arr is None:
            arr = [None] * calendar.monthrange(d.year, d.month)[1]
            m[key] = arr
        arr[d.day - 1] = int(s)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--duckdb", required=True)
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--skip-catalog", action="store_true")
    ap.add_argument("--cold", action="store_true",
                    help="load months < 2025-09-01 into public.track_streams_monthly_cold (serving copy of archived months)")
    ap.add_argument("--batch", type=int, default=1500)
    a = ap.parse_args()
    load_env()
    pg = Postgrest(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"], timeout_s=120)
    con = duckdb.connect(a.duckdb, read_only=True)
    rows = source_rows(con)
    months = build_months(rows)
    table = "track_streams_monthly"
    ceiling = LIVE_FLOOR
    if a.cold:
        table = "track_streams_monthly_cold"
        ceiling = date(2025, 9, 1)
        months = {k: v for k, v in months.items() if k[1] < ceiling}
        a.skip_catalog = True
        rows = [r for r in rows if r[0] < ceiling]
    print(f"source rows={len(rows)} isrcs={len({r[1] for r in rows})} isrc-months={len(months)}")

    if not a.verify:
        if not a.skip_catalog:
            cat = con.execute(
                "select day, tracks, streams, daily_net, is_partial, low_coverage, resets, missing_prev "
                "from catalog_day where dataset='stats2' order by day"
            ).fetchall()
            out = []
            for d, tracks, streams, net, part, low, resets, miss in cat:
                out.append({
                    "date": d.isoformat(), "track_count": int(tracks), "total_streams_cumulative": int(streams),
                    "daily_streams_net": None if (part or low or net is None) else int(net),
                    "reset_track_count": int(resets or 0), "missing_previous_track_count": int(miss or 0),
                })
            for i in range(0, len(out), 500):
                pg.upsert("legacy_catalog_daily_stats", out[i:i + 500], "date")
            print(f"catalog rows upserted={len(out)}")
        items = [{"isrc": k[0], "month": k[1].isoformat(), "vals": v} for k, v in months.items()]
        items.sort(key=lambda r: (r["month"], r["isrc"]))
        for i in range(0, len(items), a.batch):
            pg.upsert(table, items[i:i + a.batch], "isrc,month")
            print(f"  upserted {min(i + a.batch, len(items))}/{len(items)}")

    # verify: pull everything legacy-range back and compare exactly both ways
    got = {}
    off = 0
    while True:
        import requests
        h = dict(pg.h)
        r = requests.get(
            f"{pg.base}/{table}?select=isrc,month,vals&month=lt.{ceiling.isoformat()}&order=month,isrc"
            f"&limit=2000&offset={off}", headers=h, timeout=120)
        r.raise_for_status()
        b = r.json()
        if not b:
            break
        for x in b:
            got[(x["isrc"], date.fromisoformat(x["month"]))] = x["vals"]
        off += len(b)
    src = defaultdict(int)
    only_src = only_db = diff = 0
    for k, v in months.items():
        g = got.get(k)
        if g is None:
            only_src += 1
        elif list(g) != v:
            diff += 1
    only_db = sum(1 for k in got if k not in months)
    n_src = sum(1 for v in months.values() for x in v if x is not None)
    n_db = sum(1 for v in got.values() for x in v if x is not None)
    print(f"verify: months src={len(months)} db={len(got)} only_src={only_src} only_db={only_db} differing={diff}")
    print(f"verify: points src={n_src} db={n_db}")
    ok = only_src == 0 and only_db == 0 and diff == 0 and n_src == n_db == len(rows)
    print("VERIFY OK" if ok else "VERIFY FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
