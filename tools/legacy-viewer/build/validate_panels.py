#!/usr/bin/env python
"""Prove every implemented Grafana panel translation equals the original SQL run in PostgreSQL.

For every non-excluded panel target x variable sample:
  * PG   : original SQL, Grafana-style interpolation, NOW()/CURRENT_DATE replaced by the dataset anchor,
           session TimeZone=UTC, read-only                         (restored dumps on 127.0.0.1:55432)
  * DuckDB: registry ``duckdb_sql`` (translated template), same interpolation, anchor macros, PG null ordering
and compares columns, row count and values (numeric tolerance 0, float columns 1e-9 relative).

Outputs  <LEGACY_BUILD_DIR>/panel_validation.json  (+ results.jsonl, resumable)
         <LEGACY_BUILD_DIR>/PANEL_VALIDATION.md

Usage:  python validate_panels.py [--only SUBSTR] [--workers N] [--force] [--report-only]
"""
from __future__ import annotations

import argparse
import collections
import datetime as _dt
import decimal
import hashlib
import json
import math
import os
import random
import re
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app"
DOCS = HERE.parent / "docs"
sys.path.insert(0, str(APP))
import grafana_compat as gc  # noqa: E402

import common as C

WORK = C.BUILD_DIR
DEFAULT_DUCKDB = WORK / "fidelity_work.duckdb"
REGISTRY = WORK / "grafana_registry.json"
RESULTS_JSONL = WORK / "panel_validation_results.jsonl"
OUT_JSON = WORK / "panel_validation.json"
OUT_MD = WORK / "PANEL_VALIDATION.md"
VAR_JSON = WORK / "panel_validation_variables.json"

PG = dict(host=C.PG_HOST, port=C.PG_PORT, user=C.PG_USER)
REL_TOL = 1e-9
ABS_TOL = 1e-9

# ---------------------------------------------------------------------------------------------
# Sizes of the variable samples
# ---------------------------------------------------------------------------------------------
N_ARTISTS = {"stats2": 160, "stats": 40}
N_PAIRS = {"stats2": 320, "stats": 60}
SEED = 20261004


# ---------------------------------------------------------------------------------------------
# Engines
# ---------------------------------------------------------------------------------------------

def pg_connect(dbname):
    import psycopg
    conn = psycopg.connect(dbname=dbname, autocommit=True, **PG)
    conn.execute("SET TIME ZONE 'UTC'")
    conn.execute("SET statement_timeout = 0")
    conn.execute("SET default_transaction_read_only = on")
    conn.execute("SET max_parallel_workers_per_gather = 2")
    return conn


PG_CLASS = {16: "bool", 20: "int", 21: "int", 23: "int", 1700: "numeric", 700: "float", 701: "float",
            25: "text", 1043: "text", 1042: "text", 1082: "date", 1114: "timestamp", 1184: "timestamptz", 1186: "interval"}


ICU = ' COLLATE "und-x-icu"'


def oracle_ilike_utf8(sql: str) -> str:
    """The restored PG cluster is C-locale (ILIKE folds ASCII only) but the production servers ran C.UTF-8
    (Unicode-aware ctype).  Emulate production in the ORACLE by giving the left operand of every [NOT] ILIKE the ICU
    collation (Unicode case folding).  Applied to the SQL template before interpolation."""
    toks = gc.lex_sql(sql)
    out = []
    for i, tk in enumerate(toks):
        if tk[0] == "ident" and tk[1].lower() == "ilike":
            j = len(out) - 1
            while j >= 0 and out[j][0] in ("ws", "lcomment", "bcomment"):
                j -= 1
            if j >= 0 and out[j][0] == "ident" and out[j][1].lower() == "not":
                j -= 1
                while j >= 0 and out[j][0] in ("ws", "lcomment", "bcomment"):
                    j -= 1
            assert j >= 0 and out[j][0] in ("ident", "qident"), "ILIKE left operand"
            out.insert(j + 1, ("raw", ICU))
        out.append(tk)
    return gc._join(out)


def run_pg(conn, sql):
    t = time.perf_counter()
    cur = conn.cursor()
    cur.execute(sql)
    cols = [d.name for d in cur.description]
    classes = [PG_CLASS.get(d.type_code, str(d.type_code)) for d in cur.description]
    rows = cur.fetchall()
    return cols, classes, rows, (time.perf_counter() - t) * 1000


def duck_class(t) -> str:
    s = str(t).upper()
    if s in ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"):
        return "int"
    if s.startswith("DECIMAL"):
        return "numeric"
    if s in ("DOUBLE", "FLOAT", "REAL"):
        return "float"
    if s.startswith("VARCHAR"):
        return "text"
    if s == "DATE":
        return "date"
    if s.startswith("TIMESTAMP WITH"):
        return "timestamptz"
    if s.startswith("TIMESTAMP"):
        return "timestamp"
    if s.startswith("BOOL"):
        return "bool"
    return s


def run_duck(cur, sql):
    t = time.perf_counter()
    cur.execute(sql)
    cols = [d[0] for d in cur.description]
    classes = [duck_class(d[1]) for d in cur.description]
    rows = cur.fetchall()
    return cols, classes, rows, (time.perf_counter() - t) * 1000


# ---------------------------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------------------------

def _num(x):
    return isinstance(x, (int, float, decimal.Decimal)) and not isinstance(x, bool)


def _naive(dt):
    if isinstance(dt, _dt.datetime) and dt.tzinfo is not None:
        return dt.astimezone(_dt.timezone.utc).replace(tzinfo=None)
    return dt


def cells_equal(a, b, floaty: bool):
    if a is None or b is None:
        return a is None and b is None
    if _num(a) and _num(b):
        if floaty or isinstance(a, float) or isinstance(b, float):
            fa, fb = float(a), float(b)
            if math.isnan(fa) or math.isnan(fb):
                return math.isnan(fa) and math.isnan(fb)
            return math.isclose(fa, fb, rel_tol=REL_TOL, abs_tol=ABS_TOL)
        return a == b  # int/Decimal exact
    if isinstance(a, (_dt.date, _dt.datetime)) and isinstance(b, (_dt.date, _dt.datetime)):
        a, b = _naive(a), _naive(b)
        if type(a) is not type(b):
            a = a if isinstance(a, _dt.datetime) else _dt.datetime(a.year, a.month, a.day)
            b = b if isinstance(b, _dt.datetime) else _dt.datetime(b.year, b.month, b.day)
        return a == b
    return a == b


def _canon_cell(v, floaty=False):
    """Canonical form for multiset comparison.  Integer-like columns stay EXACT (tolerance 0); only genuine float
    columns are bucketed to 9 significant digits."""
    if v is None:
        return ("n",)
    if _num(v) and not floaty:
        if isinstance(v, int):
            return ("i", int(v))
        if isinstance(v, decimal.Decimal):
            return ("i", int(v)) if v == v.to_integral_value() else ("d", str(v.normalize()))
    if _num(v):
        f = float(v)
        if f == 0:
            return ("f", 0.0)
        return ("f", float(f"{f:.9g}"))
    v = _naive(v)
    if isinstance(v, _dt.datetime):
        return ("t", v.isoformat())
    if isinstance(v, _dt.date):
        return ("t", _dt.datetime(v.year, v.month, v.day).isoformat())
    return ("s", str(v))


def _canon_row(row, floaty):
    return tuple(_canon_cell(c, floaty[j]) for j, c in enumerate(row))


def final_order_keys(sql: str):
    """Names of the simple output columns in the last top-level ORDER BY of the query (or None)."""
    toks = gc.lex_sql(sql)
    depth, last = 0, None
    sig = [(i, t) for i, t in enumerate(toks) if t[0] not in ("ws", "lcomment", "bcomment")]
    for pos, (i, (k, t)) in enumerate(sig):
        if k == "op" and t == "(":
            depth += 1
        elif k == "op" and t == ")":
            depth -= 1
        elif depth == 0 and k == "ident" and t.lower() == "order" and pos + 1 < len(sig) and sig[pos + 1][1][1].lower() == "by":
            last = pos + 2
    if last is None:
        return None
    items, cur, d = [], [], 0
    for k, t in [x[1] for x in sig[last:]]:
        if k == "op" and t == "(":
            d += 1
        elif k == "op" and t == ")":
            d -= 1
        if d < 0 or (k == "op" and t == ";" and d == 0):
            break
        if k == "op" and t == "," and d == 0:
            items.append(cur); cur = []
        elif k == "ident" and t.lower() == "limit" and d == 0:
            break
        else:
            cur.append((k, t))
    items.append(cur)
    names = []
    for it in items:
        core = [x for x in it if not (x[0] == "ident" and x[1].lower() in ("asc", "desc", "nulls", "first", "last"))]
        if len(core) == 1 and core[0][0] in ("ident", "qident"):
            name = core[0][1]
            names.append(name[1:-1].replace('""', '"') if name.startswith('"') else name.lower())
        elif len(core) == 3 and core[0][0] == "ident" and core[1][1] == "." and core[2][0] in ("ident", "qident"):
            name = core[2][1]
            names.append(name[1:-1].replace('""', '"') if name.startswith('"') else name.lower())
        elif len(core) == 1 and core[0][0] == "num":
            names.append(int(core[0][1]))
        else:
            return None
    return names


def has_limit(sql: str) -> bool:
    return re.search(r"\bLIMIT\s+\d+\s*;?\s*$", sql.strip(), re.I) is not None


def compare(pg, du, pg_sql):
    """-> (status, detail dict)."""
    pcols, pcls, prows, _ = pg
    dcols, dcls, drows, _ = du
    notes = []
    if pcols != dcols:
        return "fail", {"kind": "columns", "pg": pcols, "duck": dcols}
    # class notes
    ok_pairs = {("int", "int"), ("numeric", "numeric"), ("numeric", "int"), ("int", "numeric"), ("float", "float"),
                ("text", "text"), ("date", "date"), ("timestamp", "timestamp"), ("bool", "bool"),
                ("numeric", "float"), ("float", "numeric"), ("int", "float"), ("float", "int"),
                ("timestamptz", "timestamp"), ("date", "timestamp"), ("timestamp", "date")}
    for c, a, b in zip(pcols, pcls, dcls):
        if (a, b) not in ok_pairs:
            notes.append(f"type {c}: pg={a} duck={b}")
        elif a != b and (a, b) not in {("int", "numeric"), ("numeric", "int"), ("timestamptz", "timestamp"), ("int", "float"), ("float", "int")}:
            notes.append(f"type {c}: pg={a} duck={b}")
    floaty = [("float" in (a, b)) for a, b in zip(pcls, dcls)]
    if len(prows) != len(drows):
        return "fail", {"kind": "rowcount", "pg": len(prows), "duck": len(drows)}
    first = None
    for i, (pr, dr) in enumerate(zip(prows, drows)):
        for j, (a, b) in enumerate(zip(pr, dr)):
            if not cells_equal(a, b, floaty[j]):
                first = {"row": i, "col": pcols[j], "pg": repr(a), "duck": repr(b)}
                break
        if first:
            break
    if first is None:
        return "pass", {"notes": notes} if notes else {}
    # ---- fallbacks for non-total ORDER BY
    cp = collections.Counter(_canon_row(r, floaty) for r in prows)
    cd = collections.Counter(_canon_row(r, floaty) for r in drows)
    keys = final_order_keys(pg_sql)
    keyidx = None
    if keys:
        low = [c.lower() for c in pcols]
        keyidx = []
        for k in keys:
            if isinstance(k, int):
                keyidx.append(k - 1); continue
            if k.lower() in low:
                keyidx.append(low.index(k.lower())); continue
            m = None
            for m in re.finditer(r"(?:\b\w+\.)?\b" + re.escape(k) + r"\s+AS\s+(\"[^\"]+\"|\w+)", pg_sql, re.I):
                al = m.group(1).strip('"').lower()
                if al in low:
                    keyidx.append(low.index(al)); break
            else:
                keyidx = None
                break

    def keyseq(rows):
        return [tuple(_canon_cell(r[i], floaty[i]) for i in keyidx) for r in rows]

    if cp == cd:
        if keyidx is not None and keyseq(prows) != keyseq(drows):
            return "fail", {"kind": "order_keys_differ", "first": first}
        return "pass_unordered", {"first_diff": first, "note": "same rows, tie permutation in ORDER BY",
                                  "order_keys_checked": keyidx is not None, "notes": notes}
    if has_limit(pg_sql) and keyidx is not None and keyseq(prows) == keyseq(drows):
        # LIMIT cut inside a tie group: rows strictly beyond the boundary key must be identical
        boundary = keyseq(prows)[-1] if prows else None
        pr_strict = collections.Counter(_canon_row(r, floaty) for r, k in zip(prows, keyseq(prows)) if k != boundary)
        du_strict = collections.Counter(_canon_row(r, floaty) for r, k in zip(drows, keyseq(drows)) if k != boundary)
        if pr_strict == du_strict:
            n_b = sum(1 for k in keyseq(prows) if k == boundary)
            return "pass_topn_ties", {"first_diff": first, "boundary_tie_rows": n_b,
                                      "note": "LIMIT cuts a group of tied sort keys; which tied rows are returned is arbitrary",
                                      "notes": notes}
    return "fail", {"kind": "values", "first": first, "n_pg_only": sum((cp - cd).values()), "n_duck_only": sum((cd - cp).values())}


# ---------------------------------------------------------------------------------------------
# Variable samples
# ---------------------------------------------------------------------------------------------

def rng_sample(seq, k, rnd):
    seq = list(seq)
    return seq if len(seq) <= k else rnd.sample(seq, k)


def build_artist_samples(duck, dataset, rnd):
    """Artists + (artist, track) pairs for the Spotify Dash artist/track variables."""
    ds = gc.DATASETS[dataset]
    sch = ds["schema"]
    cur = gc.ensure_session(duck, dataset)
    if dataset == "stats2":
        artists = [r[0] for r in cur.execute("select artist_name from artists order by artist_name").fetchall()]
    else:
        artists = [r[0] for r in cur.execute(
            "select distinct trim(unnest(string_split(artist, ','))) as a from tracks order by a").fetchall()]
    n_art, n_pair = N_ARTISTS[dataset], N_PAIRS[dataset]
    hard = collections.OrderedDict()

    def add(name, why):
        if name in artists:
            hard.setdefault(name, []).append(why)

    for a in artists:
        if "'" in a:
            add(a, "apostrophe")
        if '"' in a:
            add(a, "double quote")
        if "," in a:
            add(a, "comma")
        if "&" in a or "%" in a or "_" in a:
            add(a, "ampersand/wildcard char")
        if any(ord(ch) > 127 for ch in a):
            add(a, "non-ascii")
        if a != a.strip():
            add(a, "padding spaces")
        if "oslash" in a.lower() or "&#" in a:
            add(a, "html entity")
    for a in (os.environ["LEGACY_SAMPLE_ARTIST"], "Lone Tusker", "Revelries", "Offmind", "Joongle", "Piple", "DOSA", "Nøway", "Æj", "Altrøx",
              "Öldskool", "MarynCharlie", "Maryn Charlie", "Kayrae", "MVCA", "Rob Tirea", "Fo\ufffdnix", "Foínix"):
        add(a, "named hard case")
    # artists that are substrings of other artists
    sub = cur.execute("""select distinct a.a from (select unnest(?::varchar[]) as a) a
                         join (select unnest(?::varchar[]) as b) b on a.a<>b.b and b.b ilike '%'||a.a||'%'
                         where length(a.a)>=3""", [artists, artists]).fetchall()
    for a in rng_sample(sorted(r[0] for r in sub), 25, rnd):
        add(a, "substring of another artist")
    # artists of the 'Never Giving Up' tracks
    ng = cur.execute("select distinct artist from tracks where song_name in ('Never Giving Up','Never Giving Up Again')").fetchall()
    for (full,) in sorted(ng):
        for a in artists:
            if a in full:
                add(a, "Never Giving Up")
    chosen = list(hard)[: n_art // 2 + 30]
    rest = [a for a in artists if a not in hard]
    chosen += rng_sample(rest, max(0, n_art - len(chosen)), rnd)
    chosen = list(dict.fromkeys(chosen))
    chosen.append("Nonexistent Artist ZZZ")  # empty result

    # ---- tracks per artist (the dependent variable query)
    def track_options(a):
        if dataset == "stats2":
            q = "select distinct song_name from songs_by_artist where artist ilike '%' || ? || '%' order by song_name"
        else:
            q = "select distinct song_name from tracks where artist ilike '%' || ? || '%' order by song_name"
        return [r[0] for r in cur.execute(q, [a]).fetchall()]

    # hard-case track traits (computed on the dataset's tracks)
    traits = {}
    q = f"""
      with d as (select artist, song_name, spotify_track_id, count(*) n, min(created_at) fmin, max(created_at) fmax,
                       count(distinct playlist_id) npl, count(distinct date(created_at)) ndays
                from tracks group by all)
      select artist, song_name, 'single observation' from d where n=1
      union all select artist, song_name, 'multiple playlists' from d where npl>1
      union all select artist, song_name, 'first seen late' from d where fmin > timestamp '{ds['anchor']}' - interval '120 days' and n>20
      union all select artist, song_name, 'gaps' from d where ndays < date_diff('day', fmin, fmax) * 0.8 and ndays>10
    """
    for full, song, why in sorted(cur.execute(q).fetchall()):
        traits.setdefault((full, song), []).append(why)
    # resets: decreasing daily max
    for full, song in cur.execute("""
        with d as (select artist, song_name, date(created_at) dd, max(play_count) mx from tracks group by all),
             l as (select *, lag(mx) over (partition by artist, song_name order by dd) pm from d)
        select distinct artist, song_name from l where pm is not null and mx < pm""").fetchall():
        traits.setdefault((full, song), []).append("reset (play_count decrease)")
    traits = collections.OrderedDict((k, sorted(v)) for k, v in sorted(traits.items()))  # deterministic sample (DuckDB row order is not)
    # map traits to (artist_var, track_var) pairs
    pairs = collections.OrderedDict()

    def add_pair(a, t, why):
        pairs.setdefault((a, t), []).append(why)

    ng_names = ("Never Giving Up", "Never Giving Up Again")
    for a in chosen:
        if a == "Nonexistent Artist ZZZ":
            add_pair(a, "No Such Track", "empty result")
            continue
        opts = track_options(a)
        for t in ng_names:
            if t in opts:
                add_pair(a, t, "Never Giving Up")
        for t in rng_sample(opts, 2, rnd):
            add_pair(a, t, "random")
    # add trait pairs: find a variable-artist matching the full artist string
    trait_pairs = []
    for (full, song), why in traits.items():
        cand = [a for a in artists if a in full]
        if cand:
            trait_pairs.append((cand[0], song, why))
    rnd.shuffle(trait_pairs)
    seen_traits = collections.Counter()
    for a, t, why in trait_pairs:
        w = why[0]
        if seen_traits[w] >= max(8, n_pair // 14):
            continue
        seen_traits[w] += 1
        add_pair(a, t, w)
        if a not in chosen:
            chosen.append(a)
    # apostrophe / quote / comma / non-ascii tracks
    for a in list(chosen):
        if a == "Nonexistent Artist ZZZ":
            continue
        for t in track_options(a):
            if "'" in t or '"' in t or "," in t or any(ord(ch) > 127 for ch in t):
                add_pair(a, t, "special chars in track")
    # also pairs for every artist (so >= n_pair)
    plist = list(pairs)
    if len(plist) > n_pair * 1.6:
        keep = [p for p in plist if any(w != "random" for w in pairs[p])]
        rand = [p for p in plist if p not in keep]
        plist = keep + rng_sample(rand, max(0, n_pair - len(keep)), rnd)
    return {"artists": chosen, "hard": dict(hard), "pairs": plist, "pair_why": {f"{a}|{t}": w for (a, t), w in pairs.items()},
            "all_artists": len(artists), "trait_counts": dict(seen_traits)}


SAMPLES_JSON = WORK / "panel_validation_samples.json"


def load_or_build_artist_samples(duck, dataset, rnd):
    """The artist/track sample is persisted so reruns and reports use exactly the same variable values."""
    store = json.loads(SAMPLES_JSON.read_text(encoding="utf-8")) if SAMPLES_JSON.exists() else {}
    if dataset in store:
        s = store[dataset]
        s["pairs"] = [tuple(p) for p in s["pairs"]]
        return s
    s = build_artist_samples(duck, dataset, rnd)
    store[dataset] = {**s, "pairs": [list(p) for p in s["pairs"]]}
    SAMPLES_JSON.write_text(json.dumps(store, ensure_ascii=False, indent=1), encoding="utf-8")
    s["pairs"] = [tuple(p) for p in s["pairs"]]
    return s


def build_tax_samples(duck, dash, rnd):
    v = dash["variables"]
    persons = [o["value"] for o in v["person"]["options"]]
    playlists = [o["value"] for o in v["playlist_id"]["options"]]
    out = {"persons": persons, "playlists": playlists}
    if "month" in v:
        months = [o["value"] for o in v["month"].get("options", [])]
        out["months"] = months
        cur_ = v["month"]["current"]["value"]
        out["month_sets"] = [cur_ if isinstance(cur_, list) else [cur_],
                             [months[0]], [months[1]], months[:2], [months[-1]], months[3:9], months[:], ["2025-12-01"],
                             ["2025-11-01", "2025-12-01"]]
    return out


def build_pf_samples(duck, rnd, reg):
    cur = gc.ensure_session(duck, "pf")
    accounts = [r[0] for r in cur.execute("select distinct account_name from spotify_followers where account_name is not null order by 1").fetchall()]
    pairs_all = cur.execute("select distinct account_name, playlist_name from spotify_followers where account_name is not null and playlist_name is not null order by 1,2").fetchall()
    stamp_pairs = []
    for e in reg["panels"]:
        if e.get("kind") == "template":
            for i in e["instances"]:
                stamp_pairs.append((i["account_name"], i["playlist_name"]))
    stamp_pairs = list(dict.fromkeys(stamp_pairs))
    sel = list(stamp_pairs)
    extra = [p for p in pairs_all if p not in set(sel)]
    special = [p for p in extra if any(ch in p[1] + p[0] for ch in "'\"%_&,\\") or any(ord(c) > 127 for c in p[1] + p[0])]
    sel += rng_sample(special, 25, rnd)
    sel += rng_sample([p for p in extra if p not in set(sel)], 25, rnd)
    return {"accounts": accounts, "pairs": list(dict.fromkeys(sel)), "stamp_pairs": stamp_pairs}


# ---------------------------------------------------------------------------------------------
# Case generation
# ---------------------------------------------------------------------------------------------

def make_cases(reg, duck, only=None):
    rnd = random.Random(SEED)
    dashes = {d["key"]: d for d in reg["dashboards"]}
    art = {}
    cases = []
    tax_cache, pf_cache = {}, {}
    for e in reg["panels"]:
        if e["type"] in ("row", "text") or (e["status"] == "excluded" and not e.get("validate_anyway")):
            continue
        if only and only not in e["id"] and only not in (e.get("title") or ""):
            continue
        dash = dashes[e["dashboard_key"]]
        vnames = [n for n in e["template_variables"] if not n.startswith("__")]
        targets = [t for t in e["targets"] if t.get("duckdb_sql") and not t.get("excluded")]
        for t in targets:
            base = {"panel": e["id"], "ref": t["refId"], "dataset": e["dataset"], "sig": target_sig(t)}
            if e.get("kind") == "template":
                for i in e["instances"]:
                    cases.append({**base, "vars": {"__account": i["account_name"], "__playlist": i["playlist_name"]},
                                  "tag": f"stamp panel {i['panel_id']}"})
                continue
            if not vnames:
                cases.append({**base, "vars": {}, "tag": "no variables"})
                continue
            if "artist_name" in vnames or "track_name" in vnames:
                ds = e["dataset"]
                if ds not in art:
                    art[ds] = load_or_build_artist_samples(duck, ds, random.Random(f"{SEED}-{ds}"))
                s = art[ds]
                if "track_name" in vnames:
                    for a, tr in s["pairs"]:
                        cases.append({**base, "vars": {"artist_name": a, "track_name": tr}, "tag": ";".join(s["pair_why"].get(f"{a}|{tr}", []))})
                else:
                    for a in s["artists"]:
                        cases.append({**base, "vars": {"artist_name": a}, "tag": ";".join(s["hard"].get(a, [])) or "random"})
                continue
            if "person" in vnames or "playlist_id" in vnames or "month" in vnames:
                key = e["dashboard_key"]
                if key not in tax_cache:
                    tax_cache[key] = build_tax_samples(duck, dash, rnd)
                s = tax_cache[key]
                vv = []
                persons = s["persons"] if "person" in vnames else [None]
                pls = s["playlists"] if "playlist_id" in vnames else [None]
                msets = s.get("month_sets", [None]) if "month" in vnames else [None]
                if "person" in vnames and "month" in vnames:
                    for p in persons:
                        for m in msets:
                            vv.append({"person": p, "month": m})
                elif "playlist_id" in vnames and "month" in vnames:
                    for p in pls:
                        for m in msets[:5]:
                            vv.append({"playlist_id": p, "month": m})
                elif "person" in vnames:
                    vv = [{"person": p} for p in persons]
                elif "playlist_id" in vnames:
                    vv = [{"playlist_id": p} for p in pls]
                else:
                    vv = [{"month": m} for m in msets]
                for v in vv:
                    cases.append({**base, "vars": {k: x for k, x in v.items() if x is not None}, "tag": "tax sample"})
                continue
            if "account" in vnames or "playlist" in vnames:
                if "pf" not in pf_cache:
                    pf_cache["pf"] = build_pf_samples(duck, random.Random(f"{SEED}-pf"), reg)
                s = pf_cache["pf"]
                if "playlist" in vnames:
                    for a, p in s["pairs"]:
                        cases.append({**base, "vars": {"account": a, "playlist": p}, "tag": "pair"})
                else:
                    for a in s["accounts"]:
                        cases.append({**base, "vars": {"account": a}, "tag": "account"})
                    cases.append({**base, "vars": {"account": gc.ALL_VALUE}, "tag": "All (allValue 'All' -> error parity)"})
                continue
            cases.append({**base, "vars": {}, "tag": "default"})
    return cases, {"artists": art, "tax": tax_cache, "pf": pf_cache}


def case_key(c):
    return hashlib.sha1(json.dumps([c["panel"], c["ref"], c["vars"], c.get("sig")], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def target_sig(t):
    """Signature of everything that defines a validation outcome for a target (invalidates cached passes)."""
    blob = json.dumps([t.get("original_sql"), t.get("duckdb_sql"), t.get("duckdb_sql_c_locale"), t.get("nondeterminism")], sort_keys=True)
    return hashlib.md5(blob.encode()).hexdigest()[:8] + ":" + gc_version()


def gc_version():
    """Hash of the compat pieces that influence SQL results (not of the transformations)."""
    import inspect
    parts = [inspect.getsource(f) for f in (gc.translate_pg_to_duckdb, gc.interpolate, gc._format_value,
                                            gc.anchor_postgres_sql, gc.ensure_session, gc._decode_estring,
                                            gc._to_char_format)]
    parts.append(json.dumps(gc.MACROS))
    return hashlib.md5("".join(parts).encode()).hexdigest()[:8]


# ---------------------------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------------------------

class Runner:
    def __init__(self, reg, duck, workers):
        self.reg = reg
        self.duck = duck
        self.entries = {e["id"]: e for e in reg["panels"]}
        self.tls = threading.local()
        self.lock = threading.Lock()
        self.fh = None

    def pg(self, dataset):
        d = getattr(self.tls, "pg", None)
        if d is None:
            d = self.tls.pg = {}
        db = gc.DATASETS[dataset]["pg_db"]
        if db not in d:
            d[db] = pg_connect(db)
        return d[db]

    def cursor(self, dataset):
        return gc.ensure_session(self.duck, dataset)

    def _exec(self, dataset, pg_sql, du_sql):
        """Run both engines -> (pg_out, du_out, pg_err, du_err)."""
        pg_out = du_out = pg_err = du_err = None
        try:
            pg_out = run_pg(self.pg(dataset), pg_sql)
        except Exception as ex:  # noqa: BLE001
            pg_err = f"{type(ex).__name__}: {str(ex).splitlines()[0][:200]}"
        cur = self.cursor(dataset)
        try:
            du_out = run_duck(cur, du_sql)
        except Exception as ex:  # noqa: BLE001
            du_err = f"{type(ex).__name__}: {str(ex).splitlines()[0][:200]}"
        finally:
            cur.close()
        return pg_out, du_out, pg_err, du_err

    def _evaluate(self, dataset, pg_sql, du_sql, nd):
        """Compare one (PG, DuckDB) SQL pair, with the tie-broken fallback.  -> dict(status, detail, rows, pg_ms, duck_ms)."""
        pg_out, du_out, pg_err, du_err = self._exec(dataset, pg_sql, du_sql)
        if pg_err and du_err:
            return {"status": "pass_both_error", "detail": {"pg": pg_err, "duck": du_err}}
        if pg_err or du_err:
            return {"status": "fail", "detail": {"kind": "one_side_error", "pg": pg_err, "duck": du_err}}
        status, detail = compare(pg_out, du_out, pg_sql)
        res = {"status": status, "detail": detail, "rows": len(pg_out[2]), "pg_ms": round(pg_out[3], 1),
               "duck_ms": round(du_out[3], 1)}
        if status == "fail" and nd:
            try:
                pg_v, du_v = pg_sql, du_sql
                m1 = m2 = 0
                for old_re, new_txt in nd["tiebreak"]:
                    pg_v, n1 = re.subn(old_re, new_txt, pg_v, flags=re.I | re.S)
                    du_v, n2 = re.subn(old_re, new_txt, du_v, flags=re.I | re.S)
                    m1 += n1
                    m2 += n2
                    if (n1 == 0) != (n2 == 0):
                        raise RuntimeError(f"tiebreak pattern {old_re!r} matched pg={n1} duck={n2}")
                if m1 == 0 or m2 == 0:
                    raise RuntimeError("no tiebreak pattern matched")
                pv, dv, pe, de = self._exec(dataset, pg_v, du_v)
                if pe or de:
                    raise RuntimeError(f"variant error pg={pe} duck={de}")
                st2, d2 = compare(pv, dv, pg_v)
                if st2.startswith("pass"):
                    res.update(status="pass_tiebreak", detail={"original_difference": detail, "variant_status": st2,
                                                                "reason": nd["reason"]})
                else:
                    res["detail"] = {"original_difference": detail, "variant_failed": d2}
            except Exception as exv:  # noqa: BLE001
                res["detail"] = {"original_difference": detail, "variant_error": str(exv)[:300]}
        return res

    def run_target(self, dataset, t, defs, values):
        """Validate one target (dict with original_sql / duckdb_sql [/ duckdb_sql_c_locale / nondeterminism])."""
        ds = gc.DATASETS[dataset]
        nd = t.get("nondeterminism")
        pg_sql = gc.anchor_postgres_sql(gc.interpolate(t["original_sql"], defs, values), ds["anchor"])
        alt = t.get("duckdb_sql_c_locale")
        if not alt:
            return self._evaluate(dataset, pg_sql, gc.interpolate(t["duckdb_sql"], defs, values), nd)
        # ILIKE targets.  (1) C-locale PG (the restored cluster) vs the ASCII-fold translation: must pass.
        du_c = gc.interpolate(alt, defs, values)
        res = dict(self._evaluate(dataset, pg_sql, du_c, nd))
        res["c_locale_status"] = res["status"]
        if not res["status"].startswith("pass"):
            return res
        # (2) production semantics: the Unicode-aware (default) translation.  If it returns the same as the ASCII
        #     translation nothing more to do; otherwise it must equal PG with Unicode case folding (ICU oracle).
        du_u = gc.interpolate(t["duckdb_sql"], defs, values)
        cur = self.cursor(dataset)
        try:
            try:
                o_c = run_duck(cur, du_c)
                o_u = run_duck(cur, du_u)
                st, _ = compare(o_c, o_u, pg_sql)
                same = st.startswith("pass")
            except Exception:  # noqa: BLE001
                same = False
        finally:
            cur.close()
        if same:
            return res
        pg_icu = gc.anchor_postgres_sql(gc.interpolate(oracle_ilike_utf8(t["original_sql"]), defs, values), ds["anchor"])
        r_u = self._evaluate(dataset, pg_icu, du_u, nd)
        res["unicode_status"] = r_u["status"]
        if r_u["status"].startswith("pass"):
            res["status"] = "pass_unicode_oracle"
            res["detail"] = {"c_locale": res["c_locale_status"], "unicode": r_u["status"],
                             "note": "C-locale PG and Unicode-aware PG (ICU folding, emulating the production C.UTF-8 servers) differ for this value; the default translation equals the Unicode-aware oracle"}
        else:
            res["status"] = "fail"
            res["detail"] = {"unicode_oracle_failed": r_u["detail"]}
        return res

    def run_case(self, c):
        e = self.entries[c["panel"]]
        t = next(x for x in e["targets"] if x["refId"] == c["ref"])
        defs = e.get("variable_defs") or {}
        values = gc.default_values(defs)
        values.update(c["vars"])
        res = {"key": case_key(c), "panel": c["panel"], "ref": c["ref"], "dataset": c["dataset"], "vars": c["vars"],
               "tag": c.get("tag")}
        res.update(self.run_target(c["dataset"], t, defs, values))
        return res

    def write(self, res):
        with self.lock:
            self.fh.write(json.dumps(res, ensure_ascii=False, default=str) + "\n")
            self.fh.flush()


def load_results():
    out = {}
    if RESULTS_JSONL.exists():
        for line in RESULTS_JSONL.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                out[r["key"]] = r
    return out


def run_all(reg, duck, cases, workers, force):
    done = {} if force else {k: v for k, v in load_results().items() if v["status"].startswith("pass")}
    todo = [c for c in cases if case_key(c) not in done]
    print(f"cases={len(cases)} already_passed={len(done)} todo={len(todo)} workers={workers}", flush=True)
    runner = Runner(reg, duck, workers)
    runner.fh = open(RESULTS_JSONL, "a", encoding="utf-8")
    t0, n = time.time(), 0
    # group by panel so that a failing panel is visible early; shuffle inside to balance heavy ones
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(runner.run_case, c): c for c in todo}
        for f in as_completed(futs):
            c = futs[f]
            try:
                res = f.result()
            except Exception as exn:  # noqa: BLE001
                res = {"key": case_key(c), "panel": c["panel"], "ref": c["ref"], "dataset": c["dataset"], "vars": c["vars"],
                       "tag": c.get("tag"), "status": "fail", "detail": {"kind": "harness_error", "error": repr(exn),
                                                                           "tb": traceback.format_exc()[-800:]}}
            runner.write(res)
            n += 1
            if res["status"] == "fail":
                print("FAIL", res["panel"], res["ref"], json.dumps(res["vars"], ensure_ascii=False)[:100], json.dumps(res["detail"], ensure_ascii=False, default=str)[:300], flush=True)
            if n % 50 == 0:
                print(f"  {n}/{len(todo)} done, {time.time()-t0:.0f}s", flush=True)
    runner.fh.close()


# ---------------------------------------------------------------------------------------------
# Variable query validation (dropdown options)
# ---------------------------------------------------------------------------------------------

def validate_variables(reg, duck, samples):
    out = []
    runner = Runner(reg, duck, 1)
    for dash in reg["dashboards"]:
        defs = {n: v for n, v in dash["variables"].items()}
        for name, v in dash["variables"].items():
            if v["type"] != "query" or not v.get("duckdb_query") or "options_skipped" in v:
                continue
            vals_list = [{}]
            if v["depends_on"]:
                if name == "track_name":
                    arts = (samples["artists"].get(dash["dataset"]) or {}).get("artists", [])[:25]
                    vals_list = [{"artist_name": a} for a in arts]
                elif name == "playlist":
                    vals_list = [{"account": a} for a in samples["pf"]["pf"]["accounts"]]
                else:
                    continue
            for vals in vals_list:
                r = {"dashboard": dash["key"], "variable": name, "vars": vals}
                try:
                    t = {"original_sql": v["query"], "duckdb_sql": v["duckdb_query"],
                         "duckdb_sql_c_locale": v.get("duckdb_query_c_locale")}
                    r.update(runner.run_target(dash["dataset"], t, defs, {**gc.default_values(defs), **vals}))
                except Exception as ex:  # noqa: BLE001
                    r.update(status="fail", detail={"kind": "error", "error": str(ex)[:300]})
                out.append(r)
    return out


# ---------------------------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------------------------

def build_report(reg, results, var_results, extra):
    entries = {e["id"]: e for e in reg["panels"]}
    per_panel = collections.OrderedDict()
    for r in results.values():
        k = (r["panel"], r["ref"])
        d = per_panel.setdefault(k, {"panel": r["panel"], "ref": r["ref"], "counts": collections.Counter(), "first_fail": None,
                                     "pg_ms": [], "duck_ms": [], "rows": [], "notes": set(), "unordered": 0})
        d["counts"][r["status"]] += 1
        if r["status"] == "fail" and d["first_fail"] is None:
            d["first_fail"] = {"vars": r["vars"], "detail": r["detail"]}
        if "pg_ms" in r:
            d["pg_ms"].append(r["pg_ms"]); d["duck_ms"].append(r["duck_ms"]); d["rows"].append(r["rows"])
        for n in (r.get("detail") or {}).get("notes", []) or []:
            d["notes"].add(n)
    tot = collections.Counter()
    for d in per_panel.values():
        tot.update(d["counts"])
    summary = {"cases": sum(tot.values()), "by_status": dict(tot)}
    return per_panel, summary


def fmt_ms(xs):
    if not xs:
        return "-"
    xs = sorted(xs)
    return f"{xs[len(xs)//2]/1000:.2f}s (max {xs[-1]/1000:.1f}s)"


def write_outputs(reg, results, var_results, samples_meta, args_ns):
    entries = {e["id"]: e for e in reg["panels"]}
    per_panel, summary = build_report(reg, results, var_results, samples_meta)
    out = {"generated": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "summary": summary,
           "tolerances": {"numeric": "exact (int/Decimal)", "float_rel": REL_TOL, "float_abs": ABS_TOL},
           "panels": [], "variables": var_results, "sample_meta": samples_meta}
    for (pid, ref), d in per_panel.items():
        e = entries[pid]
        out["panels"].append({"panel": pid, "title": e["title"], "dashboard": e["dashboard_key"], "ref": ref,
                              "counts": dict(d["counts"]), "first_fail": d["first_fail"],
                              "pg_ms_median": sorted(d["pg_ms"])[len(d["pg_ms"]) // 2] if d["pg_ms"] else None,
                              "pg_ms_max": max(d["pg_ms"], default=None),
                              "duck_ms_median": sorted(d["duck_ms"])[len(d["duck_ms"]) // 2] if d["duck_ms"] else None,
                              "duck_ms_max": max(d["duck_ms"], default=None),
                              "max_rows": max(d["rows"], default=None), "notes": sorted(d["notes"])})
    OUT_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return out


# ---------------------------------------------------------------------------------------------
# Quirk measurements (DuckDB, stats2 dataset): how much do the original SQL's quirks change the numbers?
# ---------------------------------------------------------------------------------------------
QUIRKS_JSON = WORK / "panel_quirk_measurements.json"


def measure_quirks(duck):
    cur = gc.ensure_session(duck, "stats2")
    q = lambda sql, *a: cur.execute(sql, list(a)).fetchall()  # noqa: E731
    out = {}
    anchor_day = "2025-12-22"
    persons = ["6S9RD0jNqWh2CEvM32JOgY", "7HN9BmWouY4A5WLOJ5fHip", "7vqAjHdRCplcIIlDenPW3v",
               "3cWTrdA1YkD8ynRJQ2dfeK", "0TOebTmDhk6q2GFl5bqdIz", "2J7PnhI7rUTlQiOxrt0PkJ", "5D5udmssxsBVOTuLNddeoD",
               "079MzI42HcUzZr1Zfae4XH", "5xF12DikWaPSwjvwwVWUbe"]

    # M1: MAX(freq) join ties (Tax V2 Total/Daily, Playlist View)
    rows = q("""
      with h as (select playlist_id, date_trunc('hour', created_at) hr, sum(play_count) tot from tracks group by all),
      f as (select playlist_id, date_trunc('day', hr) as day, tot, count(*) freq from h group by all),
      m as (select playlist_id, day, max(freq) mf from f group by all),
      t as (select f.playlist_id, f.day, count(*) n_tied, max(tot)-min(tot) spread, max(tot) mx from f join m using (playlist_id, day) where f.freq = m.mf group by all)
      select (select count(*) from m) n_playlist_days,
             count(*) filter (where n_tied>1) tie_days,
             sum(n_tied-1) filter (where n_tied>1) extra_rows,
             median(spread) filter (where n_tied>1) med_spread,
             max(spread) filter (where n_tied>1) max_spread,
             max(spread / nullif(mx,0)) filter (where n_tied>1) max_rel_spread
      from t""")
    out["M1_max_freq_ties"] = dict(zip(["playlist_days", "tie_days", "extra_rows", "median_value_spread", "max_value_spread", "max_relative_spread"], rows[0]))
    out["M1_per_playlist"] = [dict(zip(["playlist_id", "tie_days", "days"], r)) for r in q("""
      with h as (select playlist_id, date_trunc('hour', created_at) hr, sum(play_count) tot from tracks group by all),
      f as (select playlist_id, date_trunc('day', hr) as day, tot, count(*) freq from h group by all),
      m as (select playlist_id, day, max(freq) mf from f group by all),
      t as (select f.playlist_id, f.day, count(*) n from f join m using (playlist_id, day) where f.freq = m.mf group by all)
      select playlist_id, count(*) filter (where n>1), count(*) from t group by 1 order by 2 desc limit 8""")]

    # M2: name based vs id based catalog total on the anchor day
    out["M2_name_vs_id"] = dict(zip(["sum_by_song_artist_name", "sum_by_spotify_id", "n_name_keys", "n_ids", "n_names_with_multiple_ids"], q("""
      with d as (select song_name, artist, spotify_track_id, play_count, count(*) fr from tracks where date(created_at) = DATE '2025-12-22' group by all),
      byid as (select spotify_track_id, arg_max(play_count, (fr, play_count)) mode_pc, any_value(song_name) sn, any_value(artist) ar from d group by spotify_track_id),
      byname as (select song_name, artist, arg_max(play_count, (fr, play_count)) mode_pc, count(distinct spotify_track_id) ids from d group by song_name, artist)
      select (select sum(mode_pc) from byname), (select sum(mode_pc) from byid), (select count(*) from byname), (select count(*) from byid),
             (select count(*) from byname where ids>1)""")[0]))

    # M3: collection gaps
    gaps = q("""
      with d as (select distinct date(created_at) dd from tracks), l as (select dd, lag(dd) over (order by dd) pd from d)
      select count(*) filter (where date_diff('day', pd, dd) > 1) gap_spans, max(date_diff('day', pd, dd)-1) longest_gap_days,
             sum(date_diff('day', pd, dd)-1) filter (where date_diff('day', pd, dd) > 1) missing_days, count(*) observed_days,
             min(dd), max(dd) from l""")[0]
    out["M3_collection_gaps"] = dict(zip(["gap_spans", "longest_gap_days", "missing_days", "observed_days", "first_day", "last_day"], map(str, gaps)))
    out["M3_gap_list"] = [dict(zip(["from", "to", "missing_days"], map(str, r))) for r in q("""
      with d as (select distinct date(created_at) dd from tracks), l as (select dd, lag(dd) over (order by dd) pd from d)
      select pd, dd, date_diff('day', pd, dd)-1 from l where date_diff('day', pd, dd) > 1 order by 3 desc limit 10""")]
    # catalog daily change on a day after a gap vs typical
    # panel 'Releases + Extended: Daily' (F2 total of the two release playlists, LAG over the previous ROW)
    out["M3_gap_effect_panel76"] = [dict(zip(["day", "days_since_previous_row", "daily_change_shown", "median_normal_day", "ratio"],
                                             map(lambda x: x if not hasattr(x, "isoformat") else str(x), r))) for r in q("""
      with h as (select playlist_id, date_trunc('hour', created_at) hr, sum(play_count) tot from tracks
                 where playlist_id in ('0OwqBeZIh0JNJcIVobdtOz', '6Cbnl3B3t8mPcEXWskPjfw') group by all),
      f as (select playlist_id, date_trunc('day', hr) as day, tot, count(*) freq from h group by all),
      m as (select playlist_id, day, tot from (select *, row_number() over (partition by day, playlist_id order by freq desc, tot desc) rn from f) where rn = 1),
      c as (select day, sum(tot) total from m group by day),
      d as (select day, total - lag(total) over (order by day) ch, date_diff('day', lag(day) over (order by day), day) gap from c),
      med as (select median(ch) mch from d where gap = 1)
      select day, gap, ch, (select mch from med), ch / (select mch from med) from d where gap > 1 order by gap desc, day limit 8""")]

    # M5: Never Giving Up merge
    out["M5_never_giving_up"] = [dict(zip(["song_name", "artist", "spotify_ids", "max_play_count", "rows"], map(str, r))) for r in q(
        """select song_name, artist, count(distinct spotify_track_id), max(play_count), count(*) from tracks
           where song_name in ('Never Giving Up','Never Giving Up Again') group by all order by 1,2""")]

    sample_artist = C.required_env("LEGACY_SAMPLE_ARTIST").replace("'", "''")
    # M6: substring artist matching
    out["M6_ilike_substring"] = {"artist_variable_options": q("select count(*) from artists")[0][0],
                                 "options_that_match_other_options": q("""select count(distinct a.artist_name) from artists a join artists b on a.artist_name<>b.artist_name
                                                                         and b.artist_name ilike '%'||a.artist_name||'%'""")[0][0],
                                 "examples": [dict(zip(["artist", "also_matches"], r)) for r in q(f"""
                                    select a.artist_name, count(distinct t.artist) from artists a join (select distinct artist from tracks) t on t.artist ilike '%'||a.artist_name||'%'
                                    where a.artist_name in ('{sample_artist}','Piple','DOSA','Offmind','Lone Tusker') group by 1 order by 2 desc""")]}
    # distinct 'tracks.artist' strings that contain the artist but are not equal / list element
    out["M6_ilike_examples_detail"] = [dict(zip(["artist_var", "distinct_artist_strings_matched", "of_which_exact_or_list_element"], map(str, r))) for r in q(f"""
        select a.artist_name, count(distinct t.artist),
               count(distinct t.artist) filter (where list_contains(list_transform(string_split(t.artist, ','), x -> trim(x)), a.artist_name))
        from artists a join (select distinct artist from tracks) t on t.artist ilike '%'||a.artist_name||'%'
        where a.artist_name in ('{sample_artist}','Piple','DOSA','Offmind','Lone Tusker','Joongle','Revelries') group by 1 order by 2 desc""")]

    # M7: 2nd-day snapshots missing (Tax V2 'In'/'Since')
    out["M7_second_day_missing"] = dict(zip(["playlist_months", "with_day2", "without_day2"], q("""
      with m as (select playlist_id, date_trunc('month', created_at) mo, count(distinct date(created_at)) filter (where extract(day from created_at) = 2) has2
                 from tracks group by all)
      select count(*), count(*) filter (where has2>0), count(*) filter (where has2=0) from m""")[0]))

    # M8: follower readings tie on timestamp, 14:00 coverage
    cur2 = gc.ensure_session(duck, "pf")
    r2 = lambda sql: cur2.execute(sql).fetchall()  # noqa: E731
    out["M8_followers_timestamp_ties"] = dict(zip(["groups_account_name_timestamp", "groups_with_duplicate_timestamp", "of_which_different_followers", "readings"], r2("""
        with g as (select account_name, playlist_name, timestamp, count(*) n, count(distinct playlist_id) nid, count(distinct followers) nf from spotify_followers group by all)
        select count(*), count(*) filter (where n>1), count(*) filter (where nf>1), (select count(*) from spotify_followers) from g""")[0]))
    out["M8_same_name_playlists"] = dict(zip(["account_playlist_name_pairs", "pairs_with_several_playlist_ids"], r2("""
        with g as (select account_name, playlist_name, count(distinct playlist_id) nid from spotify_followers group by all)
        select count(*), count(*) filter (where nid>1) from g""")[0]))
    out["M8_followers_hour14"] = dict(zip(["days", "days_with_14h_reading"], r2("""
        select count(distinct date(timestamp)), count(distinct date(timestamp)) filter (where extract(hour from timestamp)=14) from spotify_followers""")[0]))
    out["M8_followers_null_names"] = dict(zip(["rows_null_playlist_name", "rows_null_account_name", "rows_null_followers"], r2("""
        select count(*) filter (where playlist_name is null), count(*) filter (where account_name is null), count(*) filter (where followers is null) from spotify_followers""")[0]))

    # M9: milestone ties inside an hour
    out["M9_milestone_hour_ties"] = dict(zip(["groups", "groups_with_tied_top_milestone", "groups_tied_with_different_created_at"], q("""
      with g as (select song_name, artist, date_trunc('hour', created_at) hr, milestone, count(*) n, count(distinct created_at) nc from milestones group by all),
      t as (select song_name, artist, hr, max(milestone) mm from g group by all),
      j as (select g.* from g join t on g.song_name=t.song_name and g.artist=t.artist and g.hr=t.hr and g.milestone=t.mm)
      select count(*), count(*) filter (where n>1), count(*) filter (where nc>1) from j""")[0]))

    # M12: created_at ties among 'latest per day' rows (Tax Old comparison panel)
    out["M12_latest_row_ties"] = dict(zip(["partitions", "partitions_with_tie_on_latest_created_at", "of_which_different_play_count"], q("""
      with g as (select playlist_id, song_name, date(created_at) dd, created_at, count(*) n, count(distinct play_count) npc from tracks where playlist_id in ('5D5udmssxsBVOTuLNddeoD','5xF12DikWaPSwjvwwVWUbe') group by all),
      m as (select playlist_id, song_name, dd, max(created_at) mx from g group by all),
      j as (select g.* from g join m on g.playlist_id=m.playlist_id and g.song_name=m.song_name and g.dd=m.dd and g.created_at=m.mx)
      select count(*), count(*) filter (where n>1), count(*) filter (where npc>1) from j""")[0]))
    out["_notes"] = {
        "M1": "Tax V2 / Playlist View 'Total' & 'Daily': days where two hourly totals tie for the most frequent value return BOTH rows (duplicate days); value_spread = difference between the tied totals.",
        "M2": "catalog total on the anchor day: ONE mode per (song_name, artist) (what the artist/track panels do) vs one mode per spotify_track_id; the name-keyed total drops the other Spotify ids that share a name.",
        "M3": "days missing from the collection (no rows at all) and what the LAG-over-previous-row daily change shows on the day after a gap (growth of several days attributed to one day).",
        "M5": "'Never Giving Up' / '... Again' are merged by the artist panels: ONE mode is chosen over both tracks' readings, so one of the two counts is lost.",
        "M6": "artist ILIKE '%name%' substring matching: how many distinct tracks.artist strings the variable matches (list elements = real collaborations, the rest are look-alike names).",
        "M7": "Tax V2 'In'/'Since' tables need a row on the 2nd of every month; playlist-months without one are skipped (DISTINCT ON over the 2nd-day rows).",
        "M8": "followers: ties between readings of the same name/timestamp, hour-14 coverage used by 'Fastest/Slowest Growing', NULL account/followers rows, playlists sharing a name.",
        "M9": "milestones: (song, artist, hour) groups where several rows share the top milestone, so ROW_NUMBER picks arbitrarily.",
        "M12": "Tax (Old) 'Comparison: Streams': partitions (playlist, song_name, day) whose latest created_at is shared by several rows; with different play_count the SUM is arbitrary.",
    }
    return out


# ---------------------------------------------------------------------------------------------
# run_panel smoke test (frames + transformations) on DuckDB
# ---------------------------------------------------------------------------------------------
FRAMES_JSON = WORK / "panel_frames_check.json"


def check_frames(reg, duck, only=None):
    """Run every implemented panel through run_panel (SQL + transformations) with representative variables."""
    out = []
    default_art = {"artist_name": os.environ["LEGACY_SAMPLE_ARTIST"], "track_name": "Ain't No Sunshine"}
    for e in reg["panels"]:
        if e["type"] in ("row", "text") or e["status"] == "excluded" or not e.get("targets"):
            continue
        if only and only not in e["id"]:
            continue
        vars_ = {}
        if e.get("kind") == "template":
            i = e["instances"][0]
            vars_ = {"__account": i["account_name"], "__playlist": i["playlist_name"]}
        elif "artist_name" in e["template_variables"]:
            vars_ = dict(default_art)
        elif e["dashboard_key"].startswith("pf") and ("account" in e["template_variables"] or "playlist" in e["template_variables"]):
            cur = gc.ensure_session(duck, "pf")
            row = cur.execute("select account_name, playlist_name from spotify_followers where account_name = 'Groove Bassment' and playlist_name is not null limit 1").fetchone()
            vars_ = {"account": row[0], "playlist": row[1]}
        rec = {"panel": e["id"], "title": e["title"], "transformations": [t["id"] for t in e.get("transformations", [])]}
        t0 = time.perf_counter()
        try:
            fr_raw = gc.run_panel(duck, e, vars_, e["dataset"], apply_transforms=False)
            fr = gc.apply_transformations(fr_raw, e.get("transformations"))
            gc.frames_to_jsonable(fr)
            rec.update(ok=True, raw=[[len(f["columns"]), len(f["rows"])] for f in fr_raw], final=[[len(f["columns"]), len(f["rows"])] for f in fr],
                       seconds=round(time.perf_counter() - t0, 2))
        except Exception as ex:  # noqa: BLE001
            rec.update(ok=False, error=f"{type(ex).__name__}: {str(ex)[:200]}")
        out.append(rec)
    FRAMES_JSON.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


# ---------------------------------------------------------------------------------------------
# PANEL_VALIDATION.md
# ---------------------------------------------------------------------------------------------

def write_markdown(reg, out, quirks, frames, path):
    entries = {e["id"]: e for e in reg["panels"]}
    S = out["summary"]["by_status"]
    L = []
    L.append("# Original dashboards - panel validation (DuckDB vs PostgreSQL)")
    L.append("")
    L.append(f"Generated {out['generated']} by `build/validate_panels.py`. Raw per-case results: "
             "`.tmp/legacy-build/panel_validation_results.jsonl`, aggregate: `.tmp/legacy-build/panel_validation.json`.")
    L.append("")
    L.append("## Method")
    L.append("")
    L.append("* **Oracle**: the original Grafana SQL executed unchanged in the restored PostgreSQL 17.11 databases "
             "(`stats2`, `stats_old`, `playlistfollowers`; all C locale), session `TimeZone=UTC`, read-only, after Grafana 11 variable "
             "interpolation (`grafana_compat.interpolate`: SQL-datasource formatter, `${var:csv}`, `${var:raw}`, `${var:sqlstring}`, multi/includeAll, custom `allValue`).")
    L.append("* **Candidate**: the registry's `duckdb_sql` (deterministic rewrite of the same SQL, see rules below) executed on DuckDB 1.5.6 with the same interpolation, "
             "PostgreSQL NULL ordering (`default_null_order=nulls_last_on_asc_first_on_desc`) and the same anchor.")
    L.append("* **Anchor**: Grafana evaluated `NOW()` / `CURRENT_DATE` at view time. Both engines use a fixed anchor = the dataset's last observation "
             "(stats2 `2025-12-22 12:31:38.698682`, stats subset `2025-03-10 08:35:26.881731`, followers `2026-09-01 14:10:34.83615`): "
             "PG side `NOW()` -> `TIMESTAMPTZ '<anchor>+00'`, `CURRENT_DATE` -> `DATE '<anchor date>'`; DuckDB side `anchor_now()` / `anchor_date()` macros.")
    L.append("* **Equality**: same column names (case-sensitive, in order), same row count, cell-wise equality; integers / decimals / text / dates **exactly**; "
             "columns where either engine returns a float (e.g. `AVG`, numeric division) use relative tolerance 1e-9 (absolute floor 1e-9). "
             "Timestamps compared as UTC wall-clock values.")
    L.append("* **Ties**: when the SQL's ORDER BY / ROW_NUMBER is not total the result is not defined in either engine. Statuses: "
             "`pass` exact ordered equality; `pass_unordered` same rows, order differs only inside ties (the projected ORDER BY keys are compared exactly when they can be mapped to output columns); "
             "`pass_topn_ties` LIMIT cuts inside a tie group (everything strictly above the boundary key is identical); "
             "`pass_tiebreak` original results differ but a **tie-broken variant** (extra ORDER BY columns added to BOTH the original and the translated SQL, listed per rule below) is exactly equal; "
             "`pass_unicode_oracle` the C-locale PG and a Unicode-case-folding PG differ for this ILIKE value and the translation equals the latter (see ILIKE below); "
             "`pass_both_error` both engines reject the SQL (the original panel is broken, or a value breaks the quoting); `fail` anything else.")
    L.append("* **ILIKE and locale**: the restored clusters are C-locale (ILIKE folds ASCII only) but the production servers ran `C.UTF-8` "
             "(`lc_*` / `LANG` in the stats server's postgresql.conf; stats2 is the same provider/OS), whose ctype is Unicode-aware, so a value like `RÖ` matched `Rö` in Grafana. "
             "The default translation keeps DuckDB's Unicode-aware ILIKE (`grafana_compat.ILIKE_MODE = \"unicode\"`). Every ILIKE target also has a `duckdb_sql_c_locale` variant "
             "(rule R9, ASCII-only folding) which is validated **exactly** against the real restored C-locale PG; wherever the two DuckDB variants return different data, the default translation is "
             "validated against PG using an ICU collation on the ILIKE operand (Unicode folding), reported as `pass_unicode_oracle`.")
    L.append("")
    L.append("## Result")
    L.append("")
    tot = sum(S.values())
    L.append(f"**{tot} cases run, {tot - S.get('fail', 0)} pass, {S.get('fail', 0)} fail.**")
    L.append("")
    L.append("| status | cases |")
    L.append("|---|---|")
    for k in ("pass", "pass_unordered", "pass_topn_ties", "pass_tiebreak", "pass_unicode_oracle", "pass_both_error", "fail"):
        L.append(f"| {k} | {S.get(k, 0)} |")
    L.append("")
    # per dashboard
    perd = collections.OrderedDict()
    for p in out["panels"]:
        d = perd.setdefault(p["dashboard"], {"targets": 0, "panels": set(), "c": collections.Counter()})
        d["targets"] += 1
        d["panels"].add(p["panel"])
        d["c"].update(p["counts"])
    L.append("| dashboard | panels | targets | cases | exact pass | unordered / topn / tiebreak | both error | fail |")
    L.append("|---|---|---|---|---|---|---|---|")
    for k, d in perd.items():
        c = d["c"]
        L.append(f"| {k} | {len(d['panels'])} | {d['targets']} | {sum(c.values())} | {c.get('pass', 0)} | "
                 f"{c.get('pass_unordered', 0)} / {c.get('pass_topn_ties', 0)} / {c.get('pass_tiebreak', 0)} | {c.get('pass_both_error', 0)} | {c.get('fail', 0)} |")
    L.append("")
    # samples
    meta = out.get("sample_meta", {}).get("artists", {})
    L.append("## Variable samples")
    L.append("")
    for ds, m in meta.items():
        L.append(f"* **{ds} artist/track variables**: {m['n_artists']} artists and {m['n_pairs']} (artist, track) pairs per artist-panel; "
                 f"hard-case artists ({len(m['hard'])}): apostrophes/quotes/commas/non-ASCII (ø é Æ Ö ...), HTML-entity names, substrings of other artists, "
                 "'Never Giving Up' / 'Never Giving Up Again', plus the empty-result artist `Nonexistent Artist ZZZ`. "
                 f"Pair trait counts: `{json.dumps(m['trait_counts'], ensure_ascii=False)}` (single-observation tracks, tracks in several playlists, tracks first seen late, tracks with gaps, tracks with counter resets).")
    L.append("* **Tax V2**: every `person` option (5) and every `playlist_id` option (23); `month` multi-select sets: saved default (Apr..Jan 2025), single months, "
             "two/six months, all months, last two months.")
    L.append("* **Playlist Followers**: every stamped per-playlist panel instance (all dashboard-group playlists), 49 accounts, >= 60 (account, playlist) pairs incl. special-character names, and `$account = $__all` (custom allValue 'All' => both engines reject).")
    L.append("* Single-quote handling: single-value variables are interpolated with `'` -> `''` (Grafana 11 `@grafana/sql` formatter); multi/includeAll variables via `quoteLiteral`. Artists with apostrophes therefore run (and must match).")
    L.append("")
    # translation rules
    L.append("## Translation rules (PostgreSQL -> DuckDB)")
    L.append("")
    L.append("Applied by `grafana_compat.translate_pg_to_duckdb` to the SQL template (before interpolation). Everything else in the corpus is accepted by DuckDB unchanged.")
    L.append("")
    cnt = collections.Counter()
    for e in reg["panels"]:
        for t in e.get("targets", []):
            for r in t.get("translation_rules", []):
                cnt[r] += 1
            if t.get("duckdb_sql_c_locale"):
                cnt["R9 ILIKE -> ASCII-folded LIKE (C-locale PG semantics)"] += 1
    for r in ("R0 lowercase identifiers", "R1 E-string decode", "R2 NOW()/CURRENT_DATE anchored", "R3 string_to_array macro",
              "R4 to_char/to_date -> strftime/strptime", "R5 unnest alias names the column", "R6 FLOAT is float8 in PG",
              "R6 unconstrained numeric -> DECIMAL(38,10)", "R8 round -> exact decimal pg_round",
              "R9 ILIKE -> ASCII-folded LIKE (C-locale PG semantics)"):
        L.append(f"* **{r}** - used by {cnt.get(r, 0)} targets")
    L.append("")
    L.append("Reasons (all verified empirically in DuckDB 1.5.6 / PG 17):")
    L.append("")
    L.append("* R0: PostgreSQL folds unquoted identifiers to lower case; DuckDB echoes the typed case in result column names (`SELECT x AS Foo`).")
    L.append("* R1: DuckDB mis-decodes `E',\\\\s*'` (drops the backslash: `,s*`); PG yields `,\\s*`. E-strings are decoded with PG rules and re-emitted as standard literals.")
    L.append("* R2: fixed anchor, see Method. `date - interval` / `date_trunc` types agree with PG (both give timestamps).")
    L.append("* R3: PG `string_to_array('', ',')` is `{}`, DuckDB `string_split('', ',')` is `['']` (a macro keeps PG semantics, NULL stays NULL).")
    L.append("* R4: DuckDB has no `to_char`/`to_date`. Supported patterns: YYYY YY MM Mon DD HH24 HH12 MI SS Dy AM/PM and quoted text; anything else raises at build time.")
    L.append("* R5: `FROM unnest(x) AS m` names the *column* in PG; in DuckDB `m` would be the table (a struct), so the column alias is added.")
    L.append("* R6: PG `FLOAT` is float8 (DuckDB `FLOAT` is float4); an unconstrained PG `numeric` cast is `DECIMAL(18,3)` by default in DuckDB which would truncate.")
    L.append("* R8: PG rounds `numeric` half away from zero on the exact decimal; DuckDB `round(double)` works on the binary float. `pg_round` casts to `DECIMAL(38,12)` first. Defensive: an exact .xx5 tie of `ROUND(AVG(growth*0.002),2)` is possible in principle; in the 6 Tax V2 Daily samples tested (2,333 rows, tie-broken) plain `round()` gave identical values, so no measured difference.")
    L.append("* R9 (only in the `duckdb_sql_c_locale` validation variants, count above = targets carrying one): `a [NOT] ILIKE b` -> `ascii_lower(a) [NOT] LIKE ascii_lower(b)`. "
             "The shipped default keeps native ILIKE (production C.UTF-8 semantics); see ILIKE and locale in Method. `\\` is PG's default LIKE escape, DuckDB has none: irrelevant here (no backslash in any artist/song value).")
    L.append("* Session: `default_null_order=nulls_last_on_asc_first_on_desc` reproduces PG NULL ordering for every ORDER BY / window; `search_path` = dataset schema.")
    L.append("* Not rewritten (checked): `/` is always numeric division in this corpus (no integer division), `DATE(x)`, `::date`, `INTERVAL`, `DISTINCT ON`, `LATERAL`, `VALUES ... AS t(a,b)`, `= ANY(array)`, `ARRAY(subquery)`, `FILTER`, `percentile_cont`, `regexp_split_to_table`, `position(a in b)`, `ILIKE`, `trim(both x from y)`, `CAST(.. AS DATE)`.")
    L.append("")
    man = [(e["id"], t["refId"], t["manual_patches"]) for e in reg["panels"] for t in e.get("targets", []) if t.get("manual_translation")]
    if man:
        L.append("### Manual translations")
        L.append("")
        grp = collections.OrderedDict()
        for pid, ref, pats in man:
            for p in pats:
                g = grp.setdefault(p["name"], {"reason": p["reason"], "targets": []})
                g["targets"].append(f"`{pid}`" + (f" {ref}" if ref != "A" else ""))
        for name, g in grp.items():
            L.append(f"* **{name}** ({len(g['targets'])} targets: {', '.join(g['targets'])}): {g['reason']}")
        L.append("")
    else:
        L.append("No target needed a hand-written translation (`manual_translation` is false everywhere).")
        L.append("")
    # nondeterminism
    L.append("## Nondeterministic panels (ties the SQL does not define)")
    L.append("")
    L.append("These originals can legitimately return different rows in different engines (or on re-runs); the translation reproduces the SQL, "
             "and equality is proven on the tie-broken variants. `cases` = cases that actually needed the fallback.")
    L.append("")
    L.append("| panel | title | rules | cases needing fallback | note |")
    L.append("|---|---|---|---|---|")
    for p in out["panels"]:
        e = entries[p["panel"]]
        t = next((x for x in e["targets"] if x["refId"] == p["ref"]), None)
        c = p["counts"]
        n = c.get("pass_unordered", 0) + c.get("pass_topn_ties", 0) + c.get("pass_tiebreak", 0)
        if n:
            nd = (t or {}).get("nondeterminism") or {}
            if c.get("pass_tiebreak"):
                note = nd.get("reason", "")
            elif any(q.startswith("MAX(freq) join") for q in e.get("quirks", [])):
                note = "MAX(freq) join returns duplicate days; ORDER BY day has equal keys, tied rows come in arbitrary order"
            else:
                note = "ORDER BY sort key has ties (rows with equal keys come in arbitrary order / are cut by LIMIT)"
            L.append(f"| `{p['panel']}` {p['ref']} | {p['title'][:50].replace('|', '/')} | {', '.join(nd.get('rules', [])) or '-'} | "
                     f"{n} of {sum(c.values())} (unordered {c.get('pass_unordered', 0)}, topn {c.get('pass_topn_ties', 0)}, tiebreak {c.get('pass_tiebreak', 0)}) | {note[:170]} |")
    L.append("")
    flagged = []
    for p in out["panels"]:
        e = entries[p["panel"]]
        t = next((x for x in e["targets"] if x["refId"] == p["ref"]), None)
        c = p["counts"]
        if (t or {}).get("nondeterminism") and not (c.get("pass_unordered", 0) + c.get("pass_topn_ties", 0) + c.get("pass_tiebreak", 0)):
            flagged.append(f"`{p['panel']}`")
    if flagged:
        L.append("Statically flagged as tie-prone (a rule in `extract_panels.py` matched) but no tie changed the result in any validated sample: " + ", ".join(flagged) + ".")
        L.append("")
    # failures
    fails = [p for p in out["panels"] if p["counts"].get("fail")]
    L.append("## Failures")
    L.append("")
    if not fails:
        L.append("None.")
    for p in fails:
        L.append(f"* `{p['panel']}` {p['ref']} ({p['title']}): {p['counts'].get('fail')} failing cases; first: `{json.dumps(p['first_fail'], ensure_ascii=False, default=str)[:400]}`")
    L.append("")
    # per panel
    L.append("## Per-panel results")
    L.append("")
    L.append("Timings are wall-clock medians (max) per case measured while 12 validation workers x 4 DuckDB threads shared the machine and PostgreSQL, "
             "so they are upper bounds, not interactive latencies (e.g. an artist ILIKE scan is ~50 ms alone on DuckDB). The two Top Artists/Top Tracks panels with "
             "`= ANY(list)` were 13-30 s before the semi-join patch and ~0.5 s after.")
    L.append("")
    L.append("| panel | title | ref | cases | statuses | PG median (max) | DuckDB median (max) | max rows |")
    L.append("|---|---|---|---|---|---|---|---|")
    for p in out["panels"]:
        c = p["counts"]
        st = ", ".join(f"{k} {v}" for k, v in sorted(c.items()))
        pgm = f"{p['pg_ms_median']/1000:.2f}s ({p['pg_ms_max']/1000:.1f}s)" if p["pg_ms_median"] is not None else "-"
        dum = f"{p['duck_ms_median']/1000:.2f}s ({p['duck_ms_max']/1000:.1f}s)" if p["duck_ms_median"] is not None else "-"
        L.append(f"| `{p['panel']}` | {p['title'][:48].replace('|', '/')} | {p['ref']} | {sum(c.values())} | {st} | {pgm} | {dum} | {p['max_rows']} |")
    L.append("")
    # variables
    vr = out.get("variables", [])
    if vr:
        L.append("## Variable queries (dropdown options)")
        L.append("")
        L.append("| dashboard | variable | samples | statuses |")
        L.append("|---|---|---|---|")
        agg = collections.OrderedDict()
        for r in vr:
            a = agg.setdefault((r["dashboard"], r["variable"]), collections.Counter())
            a[r["status"]] += 1
        for (d, v), c in agg.items():
            L.append(f"| {d} | {v} | {sum(c.values())} | {', '.join(f'{k} {n}' for k, n in c.items())} |")
        L.append("")
    # frames
    if frames:
        ok = sum(1 for f in frames if f["ok"])
        L.append("## run_panel smoke test (SQL + transformations)")
        L.append("")
        L.append(f"`grafana_compat.run_panel` executed for {len(frames)} implemented panels with representative variables: {ok} succeeded, {len(frames) - ok} raised.")
        for f in frames:
            if not f["ok"]:
                L.append(f"* `{f['panel']}` {f['title']}: {f['error']}")
        tr = [f for f in frames if f["transformations"] and f["ok"]]
        if tr:
            L.append("")
            L.append("Panels with transformations (frames: columns x rows before -> after):")
            L.append("")
            for f in tr:
                def shape(frs):
                    return str(frs) if len(frs) <= 3 else f"{len(frs)} frames of {frs[0][0]} cols x ~{frs[0][1]} rows"
                L.append(f"* `{f['panel']}` {f['title'][:40]} {f['transformations']}: {shape(f['raw'])} -> {shape(f['final'])}")
        L.append("")
    # quirks
    if quirks:
        L.append("## Quirk measurements (stats2 dataset, DuckDB)")
        L.append("")
        try:
            m1, m2, m3 = quirks["M1_max_freq_ties"], quirks["M2_name_vs_id"], quirks["M3_collection_gaps"]
            L.append(f"* **MAX(freq) tie rows** (Tax V2 Total/Daily/Playlist View, Spotify Dash 'Total' playlist panels): {m1['tie_days']} of {m1['playlist_days']} playlist-days "
                     f"({100 * m1['tie_days'] / m1['playlist_days']:.1f}%) have two or more hourly totals tied for the most frequent value, so the 'Total' series carries {m1['extra_rows']} duplicate day-rows; "
                     f"the tied totals differ by a median of {m1['median_value_spread']:,.0f} streams (max {m1['max_value_spread']:,.0f}, up to {100 * m1['max_relative_spread']:.0f}% of the value). "
                     "Daily/avg panels built on LAG over those rows depend on the arbitrary order of the tied rows.")
            L.append(f"* **Name-keyed vs id-keyed totals**: on the last day the catalog total with one mode per (song_name, artist) is {m2['sum_by_song_artist_name']:,} vs {m2['sum_by_spotify_id']:,} "
                     f"with one mode per Spotify id ({100 * (m2['sum_by_song_artist_name'] / m2['sum_by_spotify_id'] - 1):+.1f}%): {m2['n_names_with_multiple_ids']} of {m2['n_name_keys']} (song, artist) names carry several Spotify ids.")
            L.append(f"* **Collection gaps**: {m3['gap_spans']} gap spans / {m3['missing_days']} missing days between {m3['first_day']} and {m3['last_day']} (longest {m3['longest_gap_days']} days); "
                     "LAG-over-previous-row panels put the growth of all missing days on the first day after a gap (examples in `M3_gap_effect_panel76`).")
            ng = quirks["M5_never_giving_up"]
            if len(ng) == 2:
                L.append(f"* **'Never Giving Up' merge**: the artist panels pick ONE mode over both tracks' readings; the two tracks' counts are {ng[0]['max_play_count']} and {ng[1]['max_play_count']}, so one of them is lost from the artist total.")
            m7 = quirks["M7_second_day_missing"]
            L.append(f"* **Monthly 'In' snapshots** need a row on the 2nd of the month: {m7['without_day2']} of {m7['playlist_months']} playlist-months have none and are skipped.")
            m12 = quirks["M12_latest_row_ties"]
            L.append(f"* **'Comparison: Streams' (Tax Old)**: {m12['partitions_with_tie_on_latest_created_at']} of {m12['partitions']} (playlist, song, day) partitions have several rows with the same latest created_at, {m12['of_which_different_play_count']} with different play_counts, so its SUM is arbitrary.")
            m9 = quirks["M9_milestone_hour_ties"]
            L.append(f"* **Milestone panels**: {m9['groups_with_tied_top_milestone']} of {m9['groups']} (song, artist, hour) groups have tied top milestone rows ({m9['groups_tied_with_different_created_at']} with different created_at).")
            m8 = quirks["M8_same_name_playlists"]
            L.append(f"* **Followers**: {m8['pairs_with_several_playlist_ids']} of {m8['account_playlist_name_pairs']} (account, playlist name) pairs map to several playlist ids; the per-playlist stamps filter by NAME, so they merge those ids. "
                     f"Hour-14 coverage (Fastest/Slowest Growing): {quirks['M8_followers_hour14']['days_with_14h_reading']} of {quirks['M8_followers_hour14']['days']} days.")
        except (KeyError, TypeError, ZeroDivisionError):
            pass
        L.append("")
        L.append("```json")
        L.append(json.dumps(quirks, ensure_ascii=False, indent=1, default=str))
        L.append("```")
        L.append("")
    L.append("## Known limits of the proof")
    L.append("")
    L.append("* The oracle is the restored cluster (C locale). Original servers ran `C.UTF-8` (stats server postgresql.conf; stats2 assumed identical: same provider and OS image). "
             "ORDER BY text order is therefore codepoint order in both (== DuckDB's), while ILIKE on non-ASCII letters is Unicode-aware in production (== DuckDB) but ASCII-only in the restored cluster. "
             "The ICU-collation oracle emulates glibc's Unicode folding; special letters whose simple case mapping differs between ICU and glibc (e.g. Turkish dotted I) are not exercised by the data.")
    L.append("* `LIKE`/`ILIKE` escape: PG treats `\\` as escape, DuckDB does not. No `tracks.artist`, `song_name` or `songs_by_artist` value contains a backslash (checked), so the translations agree.")
    L.append("* Grafana quoting of single-value variables (`'` -> `''`) follows Grafana 11 `@grafana/sql`; Playlist Followers ran on Grafana 10.4.1 (same behaviour assumed). Both engines receive identical text, so this cannot change an equality verdict, only whether an apostrophe artist works in the viewer as it did (or did not) in Grafana.")
    L.append("* `NOW()` / `CURRENT_DATE` panels are validated at the dataset anchor only.")
    L.append("* Heavy PG panels (Playlist Followers 'Fastest/Slowest Growing', milestone window functions) take minutes in PG; the DuckDB timings above are the viewer's.")
    path.write_text("\n".join(L), encoding="utf-8")



def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--report-only", action="store_true")
    ap.add_argument("--duckdb", default=str(DEFAULT_DUCKDB))
    ap.add_argument("--threads", type=int, default=8, help="DuckDB threads per query")
    ap.add_argument("--list-cases", action="store_true")
    ap.add_argument("--exclude-panel", action="append", default=[], help="skip this exact panel id (repeatable)")
    ap.add_argument("--measure", action="store_true", help="run the quirk measurements")
    ap.add_argument("--frames", action="store_true", help="run run_panel smoke test on every implemented panel")
    ap.add_argument("--no-vars", action="store_true", help="skip dropdown variable-query validation")
    ap.add_argument("--max-per-panel", type=int, default=0, help="first sweep: limit cases per panel target")
    args = ap.parse_args(argv)
    import duckdb
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    duck = duckdb.connect(args.duckdb, read_only=True)
    duck.execute(f"SET threads={args.threads}")
    duck.execute("SET memory_limit='48GB'")
    if args.measure:
        QUIRKS_JSON.write_text(json.dumps(measure_quirks(duck), ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        print("quirk measurements written")
    if args.frames:
        fr = check_frames(reg, duck, args.only)
        print(f"frames: {sum(1 for f in fr if f['ok'])}/{len(fr)} ok")
    if (args.measure or args.frames) and not args.report_only and not args.only and not args.max_per_panel and False:
        return 0
    cases, samples = make_cases(reg, duck, args.only)
    if args.exclude_panel:
        cases = [c for c in cases if c["panel"] not in args.exclude_panel]
    if args.max_per_panel:
        seen = collections.Counter()
        lim = []
        for c in cases:
            k = (c["panel"], c["ref"])
            if seen[k] < args.max_per_panel:
                seen[k] += 1
                lim.append(c)
        cases = lim
    if args.list_cases:
        c = collections.Counter(c["panel"] for c in cases)
        for k, v in sorted(c.items()):
            print(k, v)
        print(len(cases))
        return 0
    if not args.report_only:
        run_all(reg, duck, cases, args.workers, args.force)
    results = {k: v for k, v in load_results().items()}
    valid_keys = {case_key(c) for c in cases}
    results = {k: v for k, v in results.items() if k in valid_keys} if not args.only else results
    var_results = validate_variables(reg, duck, samples) if not args.only and not args.report_only and not args.no_vars else []
    if not var_results and VAR_JSON.exists():
        var_results = json.loads(VAR_JSON.read_text(encoding="utf-8"))
    elif var_results:
        VAR_JSON.write_text(json.dumps(var_results, ensure_ascii=False, default=str), encoding="utf-8")
    meta = {"artists": {k: {"n_artists": len(v["artists"]), "n_pairs": len(v["pairs"]), "hard": v["hard"], "trait_counts": v["trait_counts"]}
                        for k, v in samples["artists"].items()}}
    out = write_outputs(reg, results, var_results, meta, args)
    quirks = json.loads(QUIRKS_JSON.read_text(encoding="utf-8")) if QUIRKS_JSON.exists() else None
    frames = json.loads(FRAMES_JSON.read_text(encoding="utf-8")) if FRAMES_JSON.exists() else None
    write_markdown(reg, out, quirks, frames, OUT_MD)
    print(json.dumps(out["summary"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
