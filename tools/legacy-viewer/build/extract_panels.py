#!/usr/bin/env python
"""Build a private ``grafana_registry.json`` from the archived Grafana databases.

Reads (read-only, ``mode=ro&immutable=1``) the three ``grafana.db`` files and writes one registry entry
per original panel for: stats2 Spotify Dash / Tax V2 / Tax (Old), Playlist Followers, and the
stats-server Spotify Dash / Tax V2 panels whose SQL differs from stats2 (``variant_of``).

Only dashboard *definitions* are read.  Datasource rows, secureJsonData, Google-Sheets ids/auth are never
copied (Google Sheets targets are recorded as excluded, without their spreadsheet id).

Usage:  python extract_panels.py [--archive DIR] [--duckdb FILE] [--out FILE]
"""
from __future__ import annotations

import argparse
import collections
import copy
import datetime as _dt
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app"
sys.path.insert(0, str(APP))
import grafana_compat as gc  # noqa: E402

import common as C

DEFAULT_ARCHIVE = C.ARCHIVE
DEFAULT_DUCKDB = C.BUILD_DIR / "fidelity_work.duckdb"
# Private generated registry: never overwrite the public definition backup by default.
DEFAULT_OUT = C.BUILD_DIR / "grafana_registry.json"
SOURCES = [
    ("stats2", C.GRAFANA_STATS2, "stats2", "11.6.0"),
    ("stats", C.GRAFANA_STATS, "stats", "unknown (recovery clone)"),
    ("pf", C.GRAFANA_PF, "pf", "10.4.1"),
]

SLUGS = {"Spotify Dash": "spotify-dash", "Tax V2": "tax-v2", "Tax (Old)": "tax-old",
         "Playlist Followers": "playlist-followers"}

SHEETS_REASON = "external Google Sheets datasource - data not in archive"
PID_RE = re.compile(r"'([0-9A-Za-z]{22})'")
FFFD = "\ufffd"

# ---------------------------------------------------------------------------------------------
# Hand translations / patches.  Everything else is produced by grafana_compat.translate_pg_to_duckdb.
# A patch = {"name", "match": f(ctx, original_sql) -> bool, "fn": f(duckdb_sql) -> duckdb_sql, "reason"}.
# Targets touched by a patch are marked manual_translation=true in the registry.
# ---------------------------------------------------------------------------------------------
MANUAL_PATCHES: list = [
    {"name": "explicit window order",
     "reason": "AVG(stream_diff) OVER (ROWS BETWEEN 6 PRECEDING ...) has no ORDER BY: PG inherits the day order of the preceding "
               "CTE, DuckDB gives no such guarantee, so ORDER BY day is made explicit (same rows, same frame)",
     "match": lambda ctx, sql: re.search(r"AVG\(stream_diff\)\s+OVER\s*\(\s*ROWS", sql, re.I) is not None,
     "fn": lambda duck: re.sub(r"over\s*\(\s*rows\s+between", "over (order by day rows between", duck, flags=re.I)},
    {"name": "semi-join instead of cross join + = ANY(list)",
     "reason": "performance only: `FROM tracks t CROSS JOIN vars v WHERE t.playlist_id = ANY (v.sel_playlists)` evaluates list_contains per row of the "
               "34M-row table (13 s, single threaded); the equivalent `t.playlist_id IN (SELECT unnest(sel_playlists) FROM vars)` is a hash semi-join (0.5 s). "
               "Identical rows (checked in validation).",
     "match": lambda ctx, sql: re.search(r"CROSS JOIN vars v\s+WHERE t\.playlist_id = ANY\s*\(v\.sel_playlists\)", sql, re.I) is not None,
     "fn": lambda duck: re.sub(r"from tracks t\s+cross join vars v\s+where t\.playlist_id = any\s*\(v\.sel_playlists\)",
                               "from tracks t where t.playlist_id in (select unnest(sel_playlists) from vars)", duck, flags=re.I)},
]


def apply_patches(ctx, original_sql, duckdb_sql):
    notes = []
    for p in MANUAL_PATCHES:
        if p["match"](ctx, original_sql):
            new = p["fn"](duckdb_sql)
            if new != duckdb_sql:
                notes.append({"name": p["name"], "reason": p["reason"]})
                duckdb_sql = new
    return duckdb_sql, notes


def _norm_sql(sql: str) -> str:
    return re.sub(r"\s+", " ", sql or "").strip()


def _hash(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()[:10]


# ---------------------------------------------------------------------------------------------
# Quirk detectors (feature based, appended to `quirks`)
# ---------------------------------------------------------------------------------------------
QUIRK_DETECTORS = [
    (r"freq\s*=\s*m\.max_freq",
     "MAX(freq) join: when two hourly totals tie for the most frequent value on a day, BOTH rows are returned "
     "(duplicate days; the 'Total' series / sums double count that day)."),
    (r"LAG\s*\(", "Daily change = difference to the previous ROW (LAG), not the previous calendar day: a multi-day "
                  "collection gap is attributed to a single day."),
    (r"LAG\s*\([^)]*,\s*1\s*,\s*0\s*\)|COALESCE\s*\(\s*t2\.mode_play_count\s*,\s*0\s*\)",
     "First observation of a track (or a track whose previous calendar day is missing) gets daily change = its whole "
     "cumulative count (default 0 for the missing previous day)."),
    (r"0\.002", "Hard-coded revenue rate: Est. Revenue = streams x 0.002 (USD per stream), not actual revenue."),
    (r"song_name\s*=\s*'\$\{track_name\}'|position\('\$\{artist_name\}'\s+in\s+artist\)|GROUP BY\s+song_name",
     "Tracks are matched by song_name/artist text, not Spotify id: several Spotify ids (re-releases, linked ids) with "
     "the same name are summed or merged."),
    (r"ILIKE\s+'%'\s*\|\|\s*'\$\{artist_name\}'",
     "Artist match is a case-insensitive SUBSTRING match: the selected artist also matches every artist string that "
     "contains the text (collabs, longer names); '%'/'_' in names act as wildcards."),
    (r"position\('\$\{artist_name\}'\s+in\s+artist\)",
     "Artist match is a case-SENSITIVE substring match (position)."),
    (r"Never Giving Up",
     "Hard-coded merge of the two song names 'Never Giving Up' and 'Never Giving Up Again'."),
    (r"ORDER BY\s+milestone\s+DESC",
     "Ranking uses TEXT order of milestone labels ('900K' sorts above '1M'), and ties inside an hour pick an arbitrary row."),
    (r"DATE\s+'20\d\d-\d\d-\d\d'|'20\d\d-\d\d-\d\d'",
     "Hard-coded calendar dates in the SQL."),
    (r"LIMIT\s+100000\s*;?\s*$",
     "LIMIT without ORDER BY: which 100,000 rows are returned is not defined (physical order)."),
    (r"EXTRACT\s*\(\s*HOUR\s+FROM\s+hour_timestamp\s*\)\s*=\s*14",
     "Uses only the reading of the 14:00 UTC hour of today/yesterday; falls back one day when today has no 14:00 reading."),
    (r"OVER\s*\(\s*ROWS\s+BETWEEN",
     "Moving average window has no ORDER BY: relies on the row order produced by the preceding CTE (day order)."),
]

# panel specific quirks: (dashboard_key, panel_id) -> [str]
PANEL_QUIRKS = {}


def detect_quirks(sql: str) -> list:
    out = []
    for pat, text in QUIRK_DETECTORS:
        if re.search(pat, sql, re.I | re.S):
            if text not in out:
                out.append(text)
    if FFFD in sql:
        out.append("SQL literal contains U+FFFD (corrupted characters): that CASE/NOT branch can never match real data.")
    if gc.uses_now(sql):
        out.append("Relative time (NOW()/CURRENT_DATE): evaluated at the dataset anchor (last observation), "
                   "Grafana evaluated it at view time.")
    return out



# ---------------------------------------------------------------------------------------------
# Nondeterminism: SQL whose result depends on tie-breaking the SQL does not define (identical in PG
# and DuckDB: either engine may return a different, equally valid, row).  For these targets the validator
# also runs a TIE-BROKEN variant (extra ORDER BY columns applied to BOTH the original and the translated SQL),
# which must be exactly equal - proving the translation equals the original modulo tie-breaking.
# ---------------------------------------------------------------------------------------------
NONDET_RULES = [
    {"name": "row_number_ties_timestamp",
     "reason": "ROW_NUMBER() OVER (... ORDER BY timestamp DESC) keeps one of several readings with an identical timestamp",
     "when": r"ORDER BY\s+timestamp\s+DESC(?=\s*\))",
     "tiebreak": [[r"ORDER BY\s+timestamp\s+DESC(?=\s*\))", "ORDER BY timestamp DESC, followers DESC"]]},
    {"name": "row_number_ties_created_at",
     "reason": "ROW_NUMBER() OVER (... ORDER BY created_at DESC) keeps one of several rows with an identical created_at (duplicate/colliding track rows)",
     "when": r"ORDER BY\s+created_at\s+DESC(?=\s*\))",
     "tiebreak": [[r"ORDER BY\s+created_at\s+DESC(?=\s*\))", "ORDER BY created_at DESC, play_count DESC"]]},
    {"name": "milestone_rank_ties",
     "reason": "milestone ranking inside an hour: several rows share the same milestone / play_count, the kept row (and its created_at) is arbitrary",
     "when": r"ORDER BY\s+milestone\s+DESC|ORDER BY\s+play_count\s+DESC(?=\s*(?:--[^\n]*)?\s*\)\s*AS\s+rnum)",
     "tiebreak": [[r"ORDER BY\s+milestone\s+DESC", "ORDER BY milestone DESC, play_count DESC, created_at DESC"],
                  [r"ORDER BY\s+play_count\s+DESC(?=\s*(?:--[^\n]*)?\s*\)\s*AS\s+rnum)", "ORDER BY play_count DESC, created_at DESC"]]},
    {"name": "max_freq_day_ties",
     "reason": "MAX(freq) join returns several rows for a day when hourly totals tie; LAG()/moving average over duplicate days depend on their arbitrary order",
     "when": r"freq\s*=\s*m\.max_freq[\s\S]*LAG\(",
     "tiebreak": [[r"LAG\(total_stream_count\)\s+OVER\s+\(ORDER BY day\)", "LAG(total_stream_count) OVER (ORDER BY day, total_stream_count)"],
                  [r"ORDER BY\s+day\s+ROWS BETWEEN", "ORDER BY day, daily_growth ROWS BETWEEN"]]},
    {"name": "rank_ties",
     "reason": "ROW_NUMBER() OVER (ORDER BY COUNT(...) DESC): artists with the same track count get their ranks (and rank labels) in arbitrary order",
     "when": r"OVER\(ORDER BY\s+COUNT\(DISTINCT spotify_track_id\)\s+DESC\)",
     "tiebreak": [[r"ORDER BY\s+COUNT\(DISTINCT spotify_track_id\)\s+DESC\)\s+AS\s+artist_rank", "ORDER BY COUNT(DISTINCT spotify_track_id) DESC, individual_artist) AS artist_rank"]]},
    {"name": "mode_ties_same_id",
     "reason": "daily mode per Spotify id: when one id has several (song_name, artist) spellings with the same frequency and play_count on a day, "
               "ROW_NUMBER() OVER (PARTITION BY day, spotify_track_id ORDER BY freq DESC, play_count DESC) keeps an arbitrary spelling, moving that day's streams between artists",
     "when": r"spotify_track_id,\s*(?:t\.)?song_name,\s*(?:t\.)?artist,\s*(?:t\.)?play_count[\s\S]*PARTITION BY\s+(?:created_at|day),\s*spotify_track_id\s+ORDER BY\s+freq(?:uency)?\s+DESC,\s*play_count\s+DESC",
     "tiebreak": [[r"(ORDER BY\s+freq(?:uency)?\s+DESC,\s*play_count\s+DESC)(?=\s*\))", r"\1, artist, song_name"]]},
    {"name": "limit_without_order",
     "reason": "LIMIT without ORDER BY: which rows are returned is the engine's physical order",
     "when": r"FROM\s+tracks\s+LIMIT\s+100000",
     "tiebreak": [[r"FROM\s+tracks\s+LIMIT\s+100000", "FROM tracks ORDER BY id LIMIT 100000"]]},
    {"name": "limit_ties",
     "reason": "ORDER BY ... LIMIT n cuts inside a group of tied sort keys",
     "when": r"ORDER BY\s+playlist_count\s+DESC\s+LIMIT\s+50",
     "tiebreak": [[r"ORDER BY\s+playlist_count\s+DESC\s+LIMIT\s+50", "ORDER BY playlist_count DESC, track LIMIT 50"]]},
]


def detect_nondeterminism(sql: str):
    hits = [r for r in NONDET_RULES if re.search(r["when"], sql, re.I | re.S)]
    if not hits:
        return None
    return {"rules": [h["name"] for h in hits], "reason": "; ".join(h["reason"] for h in hits),
            "tiebreak": [tb for h in hits for tb in h["tiebreak"]]}

# ---------------------------------------------------------------------------------------------
# Archive reading
# ---------------------------------------------------------------------------------------------

def load_dashboards(archive: Path, key: str, rel: str) -> list:
    path = archive / rel
    con = sqlite3.connect("file:" + str(path).replace("\\", "/") + "?mode=ro&immutable=1", uri=True)
    try:
        rows = con.execute("select id, uid, title, version, data from dashboard where is_folder=0 order by id").fetchall()
    finally:
        con.close()
    out = []
    for id_, uid, title, version, data in rows:
        out.append({"server": key, "uid": uid, "title": title, "version": version, "json": json.loads(data), "db_id": id_})
    return out


def flatten(dash_json: dict):
    """Yield (panel, row_panel_or_None) with panels of collapsed rows taken from row['panels']."""
    cur = None
    rows, panels = [], []
    for p in dash_json.get("panels", []):
        if p["type"] == "row":
            cur = p
            rows.append(p)
            kids = sorted(p.get("panels", []), key=lambda c: (c["gridPos"]["y"], c["gridPos"]["x"]))
            for c in kids:
                panels.append((c, p))
        else:
            panels.append((p, cur))
    return rows, panels


def ds_kind(ds) -> str:
    t = (ds or {}).get("type", "") if isinstance(ds, dict) else ""
    if "googlesheets" in t:
        return "googlesheets"
    if "postgres" in t:
        return "postgres"
    return t or "unknown"


def variable_defs(dash_json: dict) -> dict:
    out = {}
    for v in dash_json.get("templating", {}).get("list", []):
        d = {k: v[k] for k in ("name", "label", "type", "description", "multi", "includeAll", "allValue", "hide",
                               "sort", "regex", "refresh", "skipUrlSync") if k in v}
        d["current"] = {"text": (v.get("current") or {}).get("text"), "value": (v.get("current") or {}).get("value")}
        d["query"] = v.get("query")
        d["definition"] = v.get("definition")
        d["datasource_kind"] = ds_kind(v.get("datasource")) if v.get("datasource") else None
        out[v["name"]] = d
    return out


def prune_render(p: dict) -> dict:
    fc = copy.deepcopy(p.get("fieldConfig") or {})
    opts = copy.deepcopy(p.get("options") or {})
    return {"fieldConfig": fc, "options": opts}


def translate_sql(sql: str, ctx: dict) -> dict:
    """-> {duckdb_sql, translation_rules, manual_translation, patch_notes}"""
    try:
        duck, rules = gc.translate_pg_to_duckdb(sql)
    except NotImplementedError as e:  # pragma: no cover
        return {"duckdb_sql": None, "translation_rules": [], "manual_translation": False, "translation_error": str(e)}
    duck2, patches = apply_patches(ctx, sql, duck)
    res = {"duckdb_sql": duck2, "translation_rules": rules, "manual_translation": bool(patches)}
    if re.search(r"\bilike\b", sql, re.I) and gc.ILIKE_MODE != "ascii":
        # variant with ASCII-only ILIKE folding = the restored C-locale PostgreSQL (used by the validator as an exact oracle)
        duck_c, _ = gc.translate_pg_to_duckdb(sql, ilike_mode="ascii")
        duck_c, _p = apply_patches(ctx, sql, duck_c)
        res["duckdb_sql_c_locale"] = duck_c
    if patches:
        res["manual_patches"] = patches
    return res


# ---------------------------------------------------------------------------------------------
# Entry builders
# ---------------------------------------------------------------------------------------------

def make_targets(p: dict, ctx: dict) -> list:
    tg = []
    for t in p.get("targets", []):
        kind = ds_kind(t.get("datasource") or p.get("datasource"))
        if kind == "googlesheets" or ("spreadsheet" in t and "rawSql" not in t):
            tg.append({"refId": t.get("refId"), "datasource": "googlesheets", "excluded": True,
                       "excluded_reason": SHEETS_REASON, "hide": bool(t.get("hide"))})
            continue
        sql = t.get("rawSql")
        if sql is None:
            continue
        tctx = {**ctx, "refId": t.get("refId")}
        entry = {"refId": t.get("refId"), "format": t.get("format") or "table", "hide": bool(t.get("hide")),
                 "datasource": "postgres", "original_sql": sql}
        entry.update(translate_sql(sql, tctx))
        nd = detect_nondeterminism(sql)
        if nd:
            entry["nondeterminism"] = nd
        tg.append(entry)
    return tg


def base_entry(server, dash, row, p, targets, status, reason, ds_key):
    sql_all = "\n".join(t.get("original_sql", "") for t in targets)
    pids = sorted(set(PID_RE.findall(sql_all)))
    var_names = []
    for src in [sql_all, p.get("title", "")]:
        for n in gc.extract_variable_refs(src):
            if n not in var_names:
                var_names.append(n)
    skeleton = PID_RE.sub("'<PID>'", _norm_sql(sql_all))
    render = prune_render(p)
    entry = {
        "id": f"{dash['key']}.{p['id']}",
        "server": server,
        "dashboard": dash["title"],
        "dashboard_key": dash["key"],
        "dashboard_version": dash["version"],
        "dataset": ds_key,
        "row": row["title"].strip() if row else None,
        "row_panel_id": row["id"] if row else None,
        "panel_id": p["id"],
        "title": p.get("title", ""),
        "description": p.get("description"),
        "type": p["type"],
        "gridPos": p.get("gridPos"),
        "datasource": ("postgres" if any(t.get("datasource") == "postgres" for t in targets) else
                       ("googlesheets" if targets else None)),
        "targets": targets,
        "fieldConfig": render["fieldConfig"],
        "options": render["options"],
        "transformations": p.get("transformations", []),
        "links": p.get("links"),
        "template_variables": var_names,
        "uses_now": any(gc.uses_now(t["original_sql"]) for t in targets if t.get("original_sql")),
        "uses_time_range": False,
        "status": status,
        "status_reason": reason,
        "playlist_ids": pids,
        "template_hash": _hash(skeleton) if skeleton else None,
        "quirks": [],
    }
    if p.get("repeat"):
        entry["repeat"] = {"variable": p["repeat"], "direction": p.get("repeatDirection")}
    q = []
    for t in targets:
        if t.get("original_sql"):
            for x in detect_quirks(t["original_sql"]):
                if x not in q:
                    q.append(x)
    q.extend(PANEL_QUIRKS.get((dash["key"], p["id"]), []))
    entry["quirks"] = q
    return entry


STAMP_ACC = re.compile(r"account_name\s*=\s*'((?:[^']|'')*)'")
STAMP_PL = re.compile(r"playlist_name\s*=\s*'((?:[^']|'')*)'")


def pf_stamp_split(sql: str):
    """If the SQL contains literal account_name/playlist_name filters return (template_sql, account, playlist)."""
    ma, mp = STAMP_ACC.search(sql), STAMP_PL.search(sql)
    if not ma or not mp:
        return None
    if len(STAMP_ACC.findall(sql)) != 1 or len(STAMP_PL.findall(sql)) != 1:
        return None
    acc, pl = ma.group(1).replace("''", "'"), mp.group(1).replace("''", "'")
    tpl = sql
    # replace the later match first so offsets stay valid
    spans = sorted([(ma.start(1) - 1, ma.end(1) + 1, "${__account:sqlstring}"),
                    (mp.start(1) - 1, mp.end(1) + 1, "${__playlist:sqlstring}")], reverse=True)
    for a, b, r in spans:
        tpl = tpl[:a] + r + tpl[b:]
    return tpl, acc, pl


STAMP_VAR_DEFS = {
    "__account": {"name": "__account", "type": "stamp", "multi": False, "includeAll": False},
    "__playlist": {"name": "__playlist", "type": "stamp", "multi": False, "includeAll": False},
}


# ---------------------------------------------------------------------------------------------
# Main assembly
# ---------------------------------------------------------------------------------------------

BROKEN_ORIGINAL = {
    ("stats2.tax-old", 34): "original SQL fails in PostgreSQL itself (column \"period\" does not exist: the first UNION branch has no column "
                            "aliases) - the panel never worked in Grafana; validated as error parity",
}


def decide_status(p, targets, norm_seen, dash_key):
    """-> (status, reason)"""
    t = p["type"]
    if (dash_key, p["id"]) in BROKEN_ORIGINAL:
        return "excluded", BROKEN_ORIGINAL[(dash_key, p["id"])]
    if t == "row":
        return "implemented", "row grouping"
    if t == "text":
        return "implemented", "static text panel (markdown/html content kept in options)"
    if targets and all(x.get("excluded") for x in targets):
        return "excluded", SHEETS_REASON
    if p.get("title") == "Panel Title":
        return "excluded", "test panel with the default title 'Panel Title' (noise)"
    sig = (t, p.get("title"), _norm_sql("\n".join(x.get("original_sql", "") for x in targets)))
    if sig in norm_seen and sig[2]:
        return "excluded", f"exact duplicate (same type, title and SQL) of panel {norm_seen[sig]}"
    norm_seen[sig] = p["id"]
    return "implemented", None


CONSOLIDATED = {
    # (dashboard_key, panel_id): reason  - raw table dumps are covered by an Explorer feature
    ("stats2.spotify-dash", 49): "consolidated -> Explorer 'Raw observations' table (Archive > tracks), filterable and paged; "
                                 "original SQL is just SELECT ... FROM tracks LIMIT 100000 with no ORDER BY",
    ("pf.playlist-followers", 1): "consolidated -> Explorer 'Followers raw readings' table; original is the whole "
                                  "spotify_followers table ordered by timestamp",
    ("stats.spotify-dash", 49): "consolidated -> Explorer 'Raw observations' table (stats-server subset)",
}


# ---------------------------------------------------------------------------------------------
# docs/PANEL_COVERAGE.md
# ---------------------------------------------------------------------------------------------
VALIDATION_JSON = C.BUILD_DIR / "panel_validation.json"
COVERAGE_MD = C.BUILD_DIR / "PANEL_COVERAGE.md"

EXPLORER_FEATURE_NOTES = {
    "stats2.spotify-dash.49": "Explorer > Archive > Raw observations (tracks)",
    "pf.playlist-followers.1": "Explorer > Followers > Raw readings",
    "stats.spotify-dash.49": "Explorer > Archive > Raw observations (tracks, stats-server subset)",
}


def _cell(x) -> str:
    return str(x if x is not None else "").replace("|", "\\|").replace("\n", " ")


def write_coverage(registry: dict, path: Path):
    val = {}
    if VALIDATION_JSON.exists():
        try:
            vj = json.loads(VALIDATION_JSON.read_text(encoding="utf-8"))
            for r in vj.get("panels", []):
                d = val.setdefault(r["panel"], {"pass": 0, "fail": 0, "cases": 0})
                c = r["counts"]
                n = sum(c.values())
                d["cases"] += n
                d["fail"] += c.get("fail", 0)
                d["pass"] += n - c.get("fail", 0)
        except Exception:  # noqa: BLE001
            val = {}
    panels = registry["panels"]
    out = ["# Grafana panel coverage (Original dashboards)", "",
           f"Generated by `build/extract_panels.py` on {registry['generated']} from the archived Grafana databases. "
           "Every original panel is accounted for: **implemented** = reproduced in Original mode (DuckDB translation proven "
           "equal to the PostgreSQL original, see PANEL_VALIDATION.md); **consolidated** = covered by an Explorer feature "
           "instead (its SQL is still validated); **excluded** = noise / impossible, with the reason. "
           "`validated` shows cases passed / cases run (blank = no SQL, e.g. text panels and rows).", ""]
    out.append("## Summary")
    out.append("")
    out.append("| Dashboard | version | original panels (incl. rows) | implemented | consolidated | excluded | stats-server panels identical to stats2 (skipped) |")
    out.append("|---|---|---|---|---|---|---|")
    for d in registry["dashboards"]:
        es = [e for e in panels if e["dashboard_key"] == d["key"]]
        cnt = collections.Counter()
        for e in es:
            n = len(e["instances"]) if e.get("kind") == "template" else 1
            cnt[e["status"]] += n
        out.append(f"| {d['server']} / {d['title']} | v{d['version']} | {d['panel_count_total']} | {cnt['implemented']} | "
                   f"{cnt['consolidated']} | {cnt['excluded']} | {d.get('panels_identical_to_stats2_skipped') or 0} |")
    out.append("")
    out.append("Rows are counted as implemented (structural grouping). Playlist Followers per-playlist panels are collapsed "
               "into templates + instances in the registry but each instance counts as one panel here. For the stats-server "
               "dashboards only the panels whose SQL differs from stats2 (or that exist only there) are registered; the rest "
               "are identical to the stats2 panel of the same SQL and therefore covered by it.")
    out.append("")
    for d in registry["dashboards"]:
        out.append(f"## {d['server']} / {d['title']} (v{d['version']})")
        out.append("")
        if d.get("identical_sql_to"):
            out.append(f"Identical SQL to `{d['identical_sql_to']}`: every panel is covered by that dashboard's entries; nothing extra to implement.")
            out.append("")
            continue
        es = [e for e in panels if e["dashboard_key"] == d["key"] and e["type"] != "row"]
        rows_order = [r["title"] for r in d["rows"]]
        by_row = collections.OrderedDict()
        inst_by_row = collections.OrderedDict()   # PF stamp instances grouped by their original row
        for e in es:
            if e.get("kind") == "template":
                for inst in e["instances"]:
                    inst_by_row.setdefault(inst["row"], []).append((e, inst))
                continue
            by_row.setdefault(e.get("row"), []).append(e)
        for r in inst_by_row:
            by_row.setdefault(r, [])
        order = [r for r in rows_order if r in by_row] + [r for r in by_row if r not in rows_order]
        if d["server"] == "stats":
            ids = d.get("identical_panel_ids") or []
            out.append(f"{d.get('panels_identical_to_stats2_skipped')} panels have SQL identical to the stats2 dashboard and are not repeated "
                       f"(panel ids {', '.join(map(str, ids))}). Listed below: panels whose SQL differs from stats2 (`variant_of`) or exist only on the stats server.")
            out.append("")
        for r in order:
            out.append(f"### Row: {r or '(no row)'}")
            out.append("")
            out.append("| id | title | type | status | validated | notes |")
            out.append("|---|---|---|---|---|---|")
            for e, inst in inst_by_row.get(r, []):
                v = val.get(e["id"])
                vs = (str(v["pass"]) + "/" + str(v["cases"])) if v else ""
                out.append(f"| {inst['panel_id']} | {_cell(inst['title'])} | {e['type']} | implemented | {vs} | "
                           f"stamp of template `{e['id'].split('.')[-1]}` ({_cell(e['title'])}); account `{_cell(inst['account_name'])}` |")
            for e in by_row[r]:
                v = val.get(e["id"])
                vs = (str(v["pass"]) + "/" + str(v["cases"])) if v else ""
                note = []
                if e.get("variant_of"):
                    note.append(f"variant of `{e['variant_of']}`")
                if e.get("stats_server_only"):
                    note.append("stats-server only")
                if e.get("status_reason"):
                    note.append(e["status_reason"])
                if any(t.get("manual_translation") for t in e["targets"]):
                    note.append("manual translation")
                if any(t.get("nondeterminism") for t in e["targets"]):
                    note.append("nondeterministic ties (see PANEL_VALIDATION.md)")
                if e["uses_now"]:
                    note.append("relative time, anchored")
                st = e["status"]
                if st == "consolidated":
                    note.append(EXPLORER_FEATURE_NOTES.get(e["id"], ""))
                out.append(f"| {e['panel_id']} | {_cell(e['title'])} | {e['type']} | {st} | {vs} | "
                           f"{_cell('; '.join(n for n in note if n))} |")
            out.append("")
        if d["server"] == "pf":
            out.append("### Per-playlist stamps (templates and instances)")
            out.append("")
            out.append("| template | kind | instances | rows |")
            out.append("|---|---|---|---|")
            for e in panels:
                if e["dashboard_key"] == d["key"] and e.get("kind") == "template":
                    rows = collections.Counter(i["row"] for i in e["instances"])
                    out.append(f"| `{e['id'].split('.')[-1]}` | {_cell(e['title'])} | {len(e['instances'])} | " +
                               ", ".join(f"{k} ({v})" for k, v in rows.items()) + " |")
            out.append("")
            out.append("Instances (account / playlist / source panel id) are in `grafana_registry.json` under each template's `instances`.")
            out.append("")
    out.append("## Exclusion / consolidation decisions")
    out.append("")
    for e in panels:
        if e["status"] in ("excluded", "consolidated"):
            out.append(f"- `{e['id']}` **{e['title']}** ({e['status']}): {e['status_reason']}")
    out.append("")
    path.write_text("\n".join(out), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archive", default=str(DEFAULT_ARCHIVE))
    ap.add_argument("--duckdb", default=str(DEFAULT_DUCKDB), help="optional: resolve playlist ids / variable options")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args(argv)
    archive = Path(args.archive)

    duck = None
    if args.duckdb and Path(args.duckdb).exists():
        import duckdb  # build-time only
        duck = duckdb.connect(args.duckdb, read_only=True)

    all_dash = []
    for key, rel, ds_key, gver in SOURCES:
        for d in load_dashboards(archive, key, rel):
            d["key"] = f"{key}.{SLUGS[d['title']]}"
            d["ds_key"] = ds_key
            d["grafana_version"] = gver
            all_dash.append(d)
    by_key = {d["key"]: d for d in all_dash}

    registry = {"generated": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "generator": "tools/legacy-viewer/build/extract_panels.py",
                "datasets": gc.DATASETS, "macros": [m[0] for m in gc.MACROS],
                "dashboards": [], "panels": []}

    # ---- stats2 normalized-SQL index for variant detection
    def dash_sql_index(d):
        idx = {}
        _, panels = flatten(d["json"])
        for p, _r in panels:
            for t in p.get("targets", []):
                if t.get("rawSql"):
                    idx.setdefault(_norm_sql(t["rawSql"]), []).append(p)
        return idx

    for d in all_dash:
        dj = d["json"]
        key = d["key"]
        vdefs = variable_defs(dj)
        # translate variable queries
        for name, v in vdefs.items():
            if v["type"] == "query" and v.get("query") and v["query"].strip():
                tr = translate_sql(v["query"], {"dashboard_key": key, "variable": name})
                v["duckdb_query"] = tr["duckdb_sql"]
                if tr.get("duckdb_sql_c_locale"):
                    v["duckdb_query_c_locale"] = tr["duckdb_sql_c_locale"]
                v["translation_rules"] = tr["translation_rules"]
                if tr.get("manual_translation"):
                    v["manual_translation"] = True
            elif v["type"] == "custom":
                v["options"] = gc.parse_custom_options(v.get("query") or "")
            deps = [n for n in gc.extract_variable_refs(v.get("query") or "") if n in vdefs and n != name]
            v["depends_on"] = deps
        rows, panels = flatten(dj)
        dash_rec = {
            "key": key, "server": d["server"], "title": d["title"], "uid": d["uid"], "version": d["version"],
            "grafana_version": d["grafana_version"], "dataset": d["ds_key"],
            "time": dj.get("time"), "timezone": dj.get("timezone"), "schemaVersion": dj.get("schemaVersion"),
            "variables": vdefs,
            "rows": [{"id": r["id"], "title": r["title"].strip(), "collapsed": r.get("collapsed"),
                      "gridPos": r.get("gridPos"), "n_panels": len(r.get("panels", []))} for r in rows],
            "panel_count_total": len(panels) + len(rows),
        }
        registry["dashboards"].append(dash_rec)

        is_stats_variant = d["server"] == "stats" and d["title"] in ("Spotify Dash", "Tax V2", "Tax (Old)")
        base = by_key.get(key.replace("stats.", "stats2.", 1)) if is_stats_variant else None
        base_idx = dash_sql_index(base) if base else {}
        base_panels = {p["id"]: p for p, _ in flatten(base["json"])[1]} if base else {}
        dash_rec["identical_sql_to"] = None

        norm_seen: dict = {}
        stamp_groups: dict = {}   # template hash -> entry
        included = 0
        identical = 0
        identical_ids = []

        # rows as grouping entries (only for non-variant dashboards)
        if not is_stats_variant:
            for r in rows:
                registry["panels"].append({
                    "id": f"{key}.{r['id']}", "server": d["server"], "dashboard": d["title"], "dashboard_key": key,
                    "dashboard_version": d["version"], "dataset": d["ds_key"], "row": None, "panel_id": r["id"],
                    "title": r["title"].strip(), "type": "row", "gridPos": r.get("gridPos"), "targets": [],
                    "template_variables": [], "uses_now": False, "status": "implemented",
                    "status_reason": "row grouping", "playlist_ids": [], "template_hash": None,
                    "collapsed": r.get("collapsed"), "quirks": []})

        for p, row in panels:
            ctx = {"dashboard_key": key, "panel_id": p["id"], "server": d["server"], "title": p.get("title")}
            sqls = [t["rawSql"] for t in p.get("targets", []) if t.get("rawSql")]
            variant_of = None
            if is_stats_variant:
                if sqls and all(_norm_sql(s) in base_idx for s in sqls):
                    identical += 1
                    identical_ids.append(p["id"])
                    continue
                if p["type"] in ("row", "text") or not p.get("targets"):
                    continue
                bp = base_panels.get(p["id"])
                if bp and bp.get("title") == p.get("title") and bp["type"] == p["type"]:
                    variant_of = f"{base['key']}.{p['id']}"
                else:
                    cands = [bp2 for bp2 in base_panels.values() if bp2.get("title") == p.get("title") and bp2["type"] == p["type"]]
                    variant_of = f"{base['key']}.{cands[0]['id']}" if cands else None
            targets = make_targets(p, ctx)

            # ---- Playlist Followers per-playlist stamps -> templates + instances
            stamp = None
            if d["server"] == "pf" and len(targets) == 1 and targets[0].get("original_sql"):
                stamp = pf_stamp_split(targets[0]["original_sql"])
            if stamp:
                tpl_sql, acc, pl = stamp
                chk = gc.interpolate(tpl_sql, STAMP_VAR_DEFS, {"__account": acc, "__playlist": pl})
                assert chk == targets[0]["original_sql"], f"stamp round-trip failed for panel {p['id']}"
                th = _hash(_norm_sql(tpl_sql) + "|" + p["type"])
                render_hash = _hash(json.dumps(prune_render(p), sort_keys=True))
                inst = {"panel_id": p["id"], "title": p.get("title"), "row": row["title"].strip() if row else None,
                        "account_name": acc, "playlist_name": pl, "gridPos": p.get("gridPos"),
                        "render_hash": render_hash, "links": p.get("links")}
                if duck is not None:
                    inst["playlist_ids"] = [r[0] for r in duck.execute(
                        "select distinct playlist_id from grafana.spotify_followers where account_name=? and playlist_name=? order by 1",
                        [acc, pl]).fetchall()]
                    inst["first_reading"], inst["last_reading"] = [str(x) for x in duck.execute(
                        "select min(timestamp), max(timestamp) from grafana.spotify_followers where account_name=? and playlist_name=?",
                        [acc, pl]).fetchone()]
                g = stamp_groups.get(th)
                if g is None:
                    t0 = dict(targets[0])
                    t0["original_sql"] = tpl_sql
                    t0.update(translate_sql(tpl_sql, {**ctx, "stamp_template": True}))
                    ent = base_entry(d["server"], d, None, p, [t0], "implemented", None, d["ds_key"])
                    ent["id"] = f"{key}.tpl-{th}"
                    ent["panel_id"] = None
                    ent["kind"] = "template"
                    ent["row"] = None
                    ent["title"] = re.sub(r"^\[[A-Z0-9]+\]\s*", "", p.get("title", ""))
                    ent["title"] = "per-playlist stamp: " + ("hourly" if "DATE_TRUNC('hour'" in tpl_sql and "ORDER BY" in tpl_sql and "date::date" not in tpl_sql and "SUM(latest_followers)" not in tpl_sql
                                                              else ("daily view" if "SUM(latest_followers)" in tpl_sql else "daily change"))
                    ent["template_variables"] = ["__account", "__playlist"]
                    ent["variable_defs"] = copy.deepcopy(STAMP_VAR_DEFS)
                    ent["instances"] = []
                    ent["render_variants"] = {}
                    ent["gridPos"] = None
                    ent["links"] = None
                    stamp_groups[th] = ent
                    registry["panels"].append(ent)
                    g = ent
                g["instances"].append(inst)
                g["render_variants"].setdefault(inst["render_hash"], prune_render(p))
                included += 1
                continue

            status, reason = decide_status(p, targets, norm_seen, key)
            if (key, p["id"]) in CONSOLIDATED and status == "implemented":
                status, reason = "consolidated", CONSOLIDATED[(key, p["id"])]
            if status == "implemented" and targets and any(t.get("excluded") for t in targets):
                reason = ("Google Sheets target(s) %s excluded (%s); Postgres target(s) implemented" %
                          ([t["refId"] for t in targets if t.get("excluded")], SHEETS_REASON))
            ent = base_entry(d["server"], d, row, p, targets, status, reason, d["ds_key"])
            if (key, p["id"]) in BROKEN_ORIGINAL:
                ent["validate_anyway"] = True
            m_dup = re.match(r"exact duplicate .* of panel (\d+)", reason or "")
            if status == "excluded" and m_dup:
                ent["duplicate_of"] = f"{key}.{m_dup.group(1)}"   # the UI may still render it in its row from this entry
            if variant_of or is_stats_variant:
                ent["variant_of"] = variant_of
                ent["stats_server_only"] = variant_of is None
            used_defs = {n: vdefs[n] for n in ent["template_variables"] if n in vdefs}
            ent["variable_defs"] = {n: {k: v for k, v in dv.items() if k in ("name", "type", "multi", "includeAll", "allValue", "current")}
                                    for n, dv in used_defs.items()}
            via = set()
            for n in ent["template_variables"]:
                v = vdefs.get(n)
                if v and v["type"] == "custom":
                    for o in v.get("options", []):
                        via.update(x.strip() for x in re.split(r"[;,]", o["value"]) if re.fullmatch(r"[0-9A-Za-z]{22}", x.strip()))
            ent["playlist_ids_via_variables"] = sorted(via)
            if p["type"] == "text":
                ent["content"] = (p.get("options") or {}).get("content")
            registry["panels"].append(ent)
            included += 1

        # collapse render variants
        for e in registry["panels"]:
            if e.get("kind") == "template" and e["dashboard_key"] == key:
                rv = e["render_variants"]
                if len(rv) == 1:
                    only = next(iter(rv.values()))
                    e["fieldConfig"], e["options"] = only["fieldConfig"], only["options"]
                    e["render_variants"] = None
                    for i in e["instances"]:
                        i.pop("render_hash", None)
                else:
                    keys = list(rv)
                    e["fieldConfig"], e["options"] = rv[keys[0]]["fieldConfig"], rv[keys[0]]["options"]
                    e["render_variants"] = [rv[k] for k in keys]
                    for i in e["instances"]:
                        i["render_variant"] = keys.index(i.pop("render_hash"))
        dash_rec["panels_included"] = included
        dash_rec["panels_identical_to_stats2_skipped"] = identical
        dash_rec["identical_panel_ids"] = identical_ids
        if is_stats_variant and included == 0:
            dash_rec["identical_sql_to"] = base["key"]

    # ---- resolved options for independent query variables
    if duck is not None:
        for dash in registry["dashboards"]:
            ds = gc.DATASETS[dash["dataset"]]
            for name, v in dash["variables"].items():
                if v["type"] == "query" and v.get("duckdb_query") and not v["depends_on"]:
                    used = any(name in e.get("template_variables", []) for e in registry["panels"]
                               if e["dashboard_key"] == dash["key"]) or any(
                        name in o["depends_on"] for o in dash["variables"].values())
                    if not used:  # e.g. hidden WIP variable allTracks (27M options on the stats server)
                        v["options_skipped"] = "variable is not referenced by any panel or variable"
                        continue
                    try:
                        cur = gc.ensure_session(duck, dash["dataset"])
                        cur.execute(gc.interpolate(v["duckdb_query"], {}, {}))
                        cols = [c[0].lower() for c in cur.description]
                        rows = cur.fetchall()
                        ti = cols.index("__text") if "__text" in cols else 0
                        vi = cols.index("__value") if "__value" in cols else 0
                        v["options"] = [{"text": str(r[ti]), "value": str(r[vi])} for r in rows if r[vi] is not None]
                        v["options_resolved_at"] = ds["anchor"]
                    except Exception as e:  # noqa: BLE001
                        v["options_error"] = str(e)[:300]

    out = Path(args.out)
    text = json.dumps(registry, ensure_ascii=False, indent=1)
    # no external Google Sheets references (sheet ids appear in a panel link): scrub them
    text = re.sub(r"https://docs\.google\.com/spreadsheets/[^\"\\\s]*", "[google-sheets-link-removed]", text)
    out.write_text(text, encoding="utf-8")
    write_coverage(registry, COVERAGE_MD)
    n = len(registry["panels"])
    print(f"wrote {out}  panels={n}  size={out.stat().st_size/1e6:.2f} MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
