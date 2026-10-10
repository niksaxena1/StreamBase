"""grafana_compat - run original Grafana dashboard panels offline on DuckDB.

Contents (stdlib + duckdb only, no pandas; ships inside the PyInstaller EXE):

  * Grafana 11 template-variable interpolation for SQL data sources
    (``$var``, ``${var}``, ``[[var]]``, ``${var:fmt}``; multi / includeAll / custom allValue).
  * Macro expansion for ``$__timeFilter`` & friends (none occur in the archived dashboards;
    implemented so a future dashboard fails loudly instead of silently).
  * A deterministic PostgreSQL -> DuckDB rewriter (``translate_pg_to_duckdb``).
  * Fixed "now" anchoring (``NOW()`` / ``CURRENT_DATE`` -> dataset anchor) for both engines.
  * Grafana transformations used by the archived dashboards, on result frames.
  * ``run_panel`` / ``run_variable_query``.

Frame model (plain python, JSON friendly through ``frames_to_jsonable``)::

    {"refId": "A", "name": None,
     "columns": [{"name": "time", "type": "time", "labels": None}, ...],
     "rows": [[...], ...]}

Column ``type`` is one of ``time`` / ``number`` / ``string`` / ``boolean`` / ``other``.
"""
from __future__ import annotations

import datetime as _dt
import decimal as _decimal
import json
import math
import re
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

__all__ = [
    "DATASETS", "MACROS", "lex_sql", "translate_pg_to_duckdb", "anchor_postgres_sql",
    "uses_now", "interpolate", "expand_macros", "parse_custom_options", "default_values",
    "ensure_session", "run_panel", "run_variable_query", "resolve_variable_options",
    "apply_transformations", "frames_to_jsonable", "extract_variable_refs", "sort_variable_options",
]

# ---------------------------------------------------------------------------------------------
# Datasets / anchors
# ---------------------------------------------------------------------------------------------

#: "now" for relative-time panels = the dataset's last observation (documented deviation:
#: Grafana evaluated NOW()/CURRENT_DATE at view time).  The same anchor is applied in PG when
#: validating.  ``schema`` is the DuckDB schema holding unqualified table names.
DATASETS: Dict[str, Dict[str, str]] = {
    "stats2": {"schema": "grafana", "anchor": "2025-12-22 12:31:38.698682", "pg_db": "stats2"},
    "stats": {"schema": "grafana_stats", "anchor": "2025-03-10 08:35:26.881731", "pg_db": "stats_old"},
    "pf": {"schema": "grafana", "anchor": "2026-09-01 14:10:34.83615", "pg_db": "playlistfollowers"},
}

#: "unicode" (default): keep DuckDB's native, Unicode-aware ILIKE.  The original servers ran with LANG/lc_* = C.UTF-8
#:   (stats server postgresql.conf), whose ctype is Unicode-aware, so ILIKE matched 'RO-umlaut' with 'ro-umlaut'.
#: "ascii": fold ASCII letters only = what the restored *C-locale* PostgreSQL on this PC does (R9).  Only non-ASCII names differ.
ILIKE_MODE = "unicode"

#: DuckDB macros the translated SQL relies on.  ``{anchor_ts}`` / ``{anchor_date}`` are filled per dataset.
MACROS: List[Tuple[str, str]] = [
    ("anchor_now", "CREATE OR REPLACE TEMP MACRO anchor_now() AS TIMESTAMP '{anchor_ts}'"),
    ("anchor_date", "CREATE OR REPLACE TEMP MACRO anchor_date() AS DATE '{anchor_date}'"),
    # PostgreSQL round(numeric, n): exact decimal, half away from zero (DuckDB round(double) is binary-float based)
    ("pg_round", "CREATE OR REPLACE TEMP MACRO pg_round(x, n) AS round(CAST(x AS DECIMAL(38,12)), n)"),
    # ASCII-only case folding = what ILIKE does in a C-locale PostgreSQL (DuckDB ILIKE folds Unicode: O-umlaut, slash-o ...)
    ("ascii_lower", "CREATE OR REPLACE TEMP MACRO ascii_lower(x) AS "
                    "translate(x, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')"),
    # PostgreSQL string_to_array: '' -> empty array, NULL -> NULL (DuckDB string_split('') -> [''])
    ("pg_string_to_array",
     "CREATE OR REPLACE TEMP MACRO pg_string_to_array(s, d) AS "
     "CASE WHEN s IS NULL THEN NULL WHEN s = '' THEN []::VARCHAR[] ELSE string_split(s, d) END"),
]

# ---------------------------------------------------------------------------------------------
# SQL lexer
# ---------------------------------------------------------------------------------------------

_IDENT_START = r"[A-Za-z_\u0080-\U0010ffff]"
_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<lcomment>--[^\n]*)
  | (?P<bcomment_start>/\*)
  | (?P<estring>(?<![\w$])[eE]'(?:[^'\\]|\\.|'')*')
  | (?P<string>'(?:[^']|'')*')
  | (?P<qident>"(?:[^"]|"")*")
  | (?P<var>\$\{[^}]*\}|\$[A-Za-z_]\w*)
  | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<ident>""" + _IDENT_START + r"""[\w$\u0080-\U0010ffff]*)
  | (?P<op>::|\|\||<>|<=|>=|!=|=>|.)
    """,
    re.X | re.S,
)


def lex_sql(sql: str) -> List[Tuple[str, str]]:
    """Split SQL into (kind, text) tokens; concatenating the texts reproduces the input."""
    out: List[Tuple[str, str]] = []
    pos, n = 0, len(sql)
    while pos < n:
        m = _TOKEN_RE.match(sql, pos)
        if not m:  # pragma: no cover - '.' matches everything
            raise ValueError(f"cannot lex at {pos}: {sql[pos:pos+20]!r}")
        kind = m.lastgroup
        if kind == "bcomment_start":  # PostgreSQL block comments nest
            depth, i = 1, m.end()
            while i < n and depth:
                if sql.startswith("/*", i):
                    depth += 1; i += 2
                elif sql.startswith("*/", i):
                    depth -= 1; i += 2
                else:
                    i += 1
            out.append(("bcomment", sql[pos:i])); pos = i
            continue
        out.append((kind, m.group(0))); pos = m.end()
    return out


def _join(tokens: Iterable[Tuple[str, str]]) -> str:
    return "".join(t[1] for t in tokens)


def _sig(tokens: List[Tuple[str, str]], i: int, step: int) -> int:
    """Index of the next significant (non-ws/comment) token from i going in direction step, or -1."""
    j = i + step
    while 0 <= j < len(tokens):
        if tokens[j][0] not in ("ws", "lcomment", "bcomment"):
            return j
        j += step
    return -1


def _match_paren(tokens: List[Tuple[str, str]], open_idx: int) -> int:
    depth = 0
    for j in range(open_idx, len(tokens)):
        if tokens[j][0] == "op":
            if tokens[j][1] == "(":
                depth += 1
            elif tokens[j][1] == ")":
                depth -= 1
                if depth == 0:
                    return j
    raise ValueError("unbalanced parentheses")


def _split_args(tokens: List[Tuple[str, str]], open_idx: int, close_idx: int) -> List[List[Tuple[str, str]]]:
    args, cur, depth = [], [], 0
    for t in tokens[open_idx + 1:close_idx]:
        if t[0] == "op" and t[1] == "(":
            depth += 1
        elif t[0] == "op" and t[1] == ")":
            depth -= 1
        if t[0] == "op" and t[1] == "," and depth == 0:
            args.append(cur); cur = []
        else:
            cur.append(t)
    args.append(cur)
    return args


# ---------------------------------------------------------------------------------------------
# PostgreSQL string-literal helpers
# ---------------------------------------------------------------------------------------------

_ESC_MAP = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def _decode_estring(text: str) -> str:
    """Decode a PostgreSQL E'...' literal (text includes the E and quotes) to its value."""
    body = text[2:-1]
    out, i = [], 0
    while i < len(body):
        c = body[i]
        if c == "'" and body[i + 1:i + 2] == "'":
            out.append("'"); i += 2
        elif c == "\\":
            nxt = body[i + 1:i + 2]
            if nxt in _ESC_MAP:
                out.append(_ESC_MAP[nxt]); i += 2
            elif nxt == "x":
                m = re.match(r"[0-9A-Fa-f]{1,2}", body[i + 2:])
                out.append(chr(int(m.group(0), 16))); i += 2 + len(m.group(0))
            elif nxt in "01234567":
                m = re.match(r"[0-7]{1,3}", body[i + 1:])
                out.append(chr(int(m.group(0), 8))); i += 1 + len(m.group(0))
            elif nxt == "u":
                out.append(chr(int(body[i + 2:i + 6], 16))); i += 6
            elif nxt == "U":
                out.append(chr(int(body[i + 2:i + 10], 16))); i += 10
            else:
                out.append(nxt); i += 2
        else:
            out.append(c); i += 1
    return "".join(out)


def _string_value(text: str) -> str:
    """Value of a standard 'string' token."""
    return text[1:-1].replace("''", "'")


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


# PostgreSQL to_char pattern -> strftime
_TO_CHAR_TOKENS = [
    ("HH24", "%H"), ("HH12", "%I"), ("YYYY", "%Y"), ("Mon", "%b"), ("MM", "%m"), ("DD", "%d"),
    ("MI", "%M"), ("SS", "%S"), ("YY", "%y"), ("HH", "%I"), ("Dy", "%a"), ("AM", "%p"), ("PM", "%p"),
]


def _to_char_format(fmt: str) -> str:
    out, i = [], 0
    while i < len(fmt):
        if fmt[i] == '"':
            j = fmt.index('"', i + 1)
            out.append(fmt[i + 1:j].replace("%", "%%")); i = j + 1
            continue
        for pg, sf in _TO_CHAR_TOKENS:
            if fmt.startswith(pg, i):
                out.append(sf); i += len(pg); break
        else:
            ch = fmt[i]
            if ch.isalpha():
                raise NotImplementedError(f"to_char pattern letter {fmt[i:i+4]!r} in {fmt!r}")
            out.append("%%" if ch == "%" else ch); i += 1
    return "".join(out)


# ---------------------------------------------------------------------------------------------
# PG -> DuckDB translation
# ---------------------------------------------------------------------------------------------

def translate_pg_to_duckdb(sql: str, ilike_mode: Optional[str] = None) -> Tuple[str, List[str]]:
    """Deterministic rewrite of PostgreSQL SQL into DuckDB SQL.  Returns (sql, applied_rules).

    Rules (see docs/PANEL_VALIDATION.md for the evidence behind each):
      R0 lower-case unquoted identifiers (PG folds; DuckDB would echo the typed case in column names)
      R1 E'..' strings decoded with PostgreSQL escape rules and re-emitted as standard literals
         (DuckDB mis-decodes ``E'\\\\s'``)
      R2 NOW() -> anchor_now(), CURRENT_DATE -> anchor_date()   (dataset anchor, see DATASETS)
      R3 string_to_array -> pg_string_to_array   (PG: '' -> {} ; DuckDB string_split: '' -> [''])
      R4 TO_CHAR(x, fmt) -> strftime(x, fmt');  TO_DATE(x, 'YYYY-MM-DD') -> CAST(strptime(..) AS DATE)
      R5 FROM unnest(x) AS a  ->  FROM unnest(x) AS a(a)   (PG names the column, DuckDB the table)
      R9 a [NOT] ILIKE b -> ascii_lower(a) [NOT] LIKE ascii_lower(b)  (PG C-locale ILIKE folds ASCII only)
      R8 ROUND(x, n) -> pg_round(x, n)  (CAST to DECIMAL(38,12) first: PG rounds exact numerics half away from zero)
      R6 CAST(.. AS FLOAT) -> DOUBLE (PG FLOAT = float8, DuckDB FLOAT = float4);
         ::decimal/numeric without precision -> DECIMAL(38,10) (DuckDB default is DECIMAL(18,3))
    NULL ordering is handled by the session setting ``default_null_order`` (see ensure_session).
    """
    toks = lex_sql(sql)
    rules: List[str] = []

    def note(r: str):
        if r not in rules:
            rules.append(r)

    # R1 + R0 first (token-wise)
    for i, (k, t) in enumerate(toks):
        if k == "estring":
            toks[i] = ("string", _quote(_decode_estring(t))); note("R1 E-string decode")
        elif k == "ident":
            low = t.lower()
            if low != t:
                toks[i] = ("ident", low); note("R0 lowercase identifiers")

    i = 0
    out: List[Tuple[str, str]] = []
    n = len(toks)
    suffix_after: Dict[int, str] = {}
    while i < n:
        k, t = toks[i]
        if i in suffix_after:
            out.append(toks[i]); out.append(("raw", suffix_after[i])); i += 1; continue
        if k != "ident":
            out.append(toks[i]); i += 1; continue
        nxt = _sig(toks, i, 1)
        nxt_is_paren = nxt != -1 and toks[nxt] == ("op", "(")
        prev = _sig(toks, i, -1)
        prev_txt = toks[prev][1].lower() if prev != -1 else ""
        # R2 now()/current_date
        if t == "now" and nxt_is_paren and _sig(toks, nxt, 1) != -1 and toks[_sig(toks, nxt, 1)] == ("op", ")"):
            close = _sig(toks, nxt, 1)
            out.append(("ident", "anchor_now")); out.append(("op", "(")); out.append(("op", ")"))
            i = close + 1; note("R2 NOW()/CURRENT_DATE anchored"); continue
        if t == "current_date" and not nxt_is_paren:
            out.append(("ident", "anchor_date")); out.append(("op", "(")); out.append(("op", ")"))
            i += 1; note("R2 NOW()/CURRENT_DATE anchored"); continue
        if t in ("current_timestamp", "localtimestamp", "current_time", "localtime", "clock_timestamp",
                 "statement_timestamp", "transaction_timestamp") and prev_txt != ".":
            raise NotImplementedError(f"{t} is not anchored by this translator")
        # R3
        if t == "string_to_array" and nxt_is_paren:
            out.append(("ident", "pg_string_to_array")); i += 1; note("R3 string_to_array macro"); continue
        # R9 [NOT] ILIKE -> ascii_lower(a) [NOT] LIKE ascii_lower(b)   (ILIKE_MODE == "ascii")
        if t == "ilike" and (ilike_mode or ILIKE_MODE) == "ascii":
            # left operand: the last operand tokens already emitted (column, optionally qualified)
            j = len(out) - 1
            negate = False
            while j >= 0 and out[j][0] in ("ws", "lcomment", "bcomment"):
                j -= 1
            if j >= 0 and out[j] == ("ident", "not"):
                negate = True
                del out[j:]
                j = len(out) - 1
                while j >= 0 and out[j][0] in ("ws", "lcomment", "bcomment"):
                    j -= 1
            if j < 0 or out[j][0] not in ("ident", "qident"):
                raise NotImplementedError("ILIKE with a non-column left operand")
            left_idx = j
            if j >= 2 and out[j - 1] == ("op", ".") and out[j - 2][0] in ("ident", "qident"):
                left_idx = j - 2
            left_txt = _join(out[left_idx:])
            del out[left_idx:]
            # right operand: chain of string / variable tokens joined by ||
            k = nxt
            chain, last_idx = [], nxt
            while k != -1 and (toks[k][0] in ("string", "var") or toks[k] == ("op", "||")):
                chain.append(toks[k]); last_idx = k; k = _sig(toks, k, 1)
            if not chain or chain[0][0] not in ("string", "var"):
                raise NotImplementedError("ILIKE with a non-literal right operand")
            right_txt = " ".join(x[1] for x in chain)
            out.append(("raw", f"ascii_lower({left_txt.strip()}) {'NOT ' if negate else ''}LIKE ascii_lower({right_txt})"))
            i = last_idx + 1
            note("R9 ILIKE -> ASCII-folded LIKE (C-locale PG semantics)")
            continue
        # R8 round(x, n)
        if t == "round" and nxt_is_paren and prev_txt != ".":
            close = _match_paren(toks, nxt)
            if len(_split_args(toks, nxt, close)) == 2:
                out.append(("ident", "pg_round")); i += 1; note("R8 round -> exact decimal pg_round"); continue
        # R4 to_char / to_date
        if t in ("to_char", "to_date") and nxt_is_paren:
            close = _match_paren(toks, nxt)
            args = _split_args(toks, nxt, close)
            if len(args) != 2:
                raise NotImplementedError(f"{t} with {len(args)} args")
            fmt_toks = [x for x in args[1] if x[0] not in ("ws", "lcomment", "bcomment")]
            if len(fmt_toks) != 1 or fmt_toks[0][0] != "string":
                raise NotImplementedError(f"{t} with non-literal format")
            sf = _quote(_to_char_format(_string_value(fmt_toks[0][1])))
            inner_t, inner_rules = translate_pg_to_duckdb(_join(args[0]), ilike_mode)
            for r in inner_rules:
                note(r)
            if t == "to_char":
                text = f"strftime({inner_t.strip()}, {sf})"
            else:
                if _string_value(fmt_toks[0][1]) != "YYYY-MM-DD":
                    raise NotImplementedError("to_date format")
                text = f"CAST(strptime({inner_t.strip()}, {sf}) AS DATE)"
            out.append(("raw", text)); i = close + 1; note("R4 to_char/to_date -> strftime/strptime"); continue
        # R5 FROM unnest(..) AS alias
        if t == "unnest" and nxt_is_paren and prev_txt in ("from", "join", ","):
            # only when it is a FROM-item: previous significant keyword is FROM (or JOIN/LATERAL context)
            if prev_txt in ("from", "join"):
                close = _match_paren(toks, nxt)
                a = _sig(toks, close, 1)
                if a != -1 and toks[a][1].lower() == "as":
                    b = _sig(toks, a, 1)
                    after = _sig(toks, b, 1) if b != -1 else -1
                    if b != -1 and toks[b][0] in ("ident", "qident") and not (after != -1 and toks[after] == ("op", "(")):
                        suffix_after[b] = f"({toks[b][1]})"; note("R5 unnest alias names the column")
        # R6 float/decimal casts
        if t == "float" and prev_txt in ("::", "as") and not nxt_is_paren:
            out.append(("ident", "double")); i += 1; note("R6 FLOAT is float8 in PG"); continue
        if t in ("decimal", "numeric") and prev_txt in ("::", "as") and not nxt_is_paren:
            out.append(("ident", "decimal(38,10)")); i += 1; note("R6 unconstrained numeric -> DECIMAL(38,10)"); continue
        out.append(toks[i]); i += 1
    return _join(out), rules


# ---------------------------------------------------------------------------------------------
# Anchoring for PostgreSQL (validation side) and NOW() detection
# ---------------------------------------------------------------------------------------------

def anchor_postgres_sql(sql: str, anchor_ts: str) -> str:
    """Replace NOW()/CURRENT_DATE in *PostgreSQL* SQL by the dataset anchor (token aware)."""
    toks = lex_sql(sql)
    anchor_date = anchor_ts[:10]
    out: List[Tuple[str, str]] = []
    i, n = 0, len(toks)
    while i < n:
        k, t = toks[i]
        low = t.lower()
        if k == "ident":
            nxt = _sig(toks, i, 1)
            if low == "now" and nxt != -1 and toks[nxt] == ("op", "("):
                c = _sig(toks, nxt, 1)
                if c != -1 and toks[c] == ("op", ")"):
                    out.append(("raw", f"TIMESTAMPTZ '{anchor_ts}+00'")); i = c + 1; continue
            if low == "current_date" and not (nxt != -1 and toks[nxt] == ("op", "(")):
                out.append(("raw", f"DATE '{anchor_date}'")); i += 1; continue
            if low in ("current_timestamp", "localtimestamp"):
                raise NotImplementedError(low)
        out.append(toks[i]); i += 1
    return _join(out)


def uses_now(sql: str) -> bool:
    toks = lex_sql(sql)
    for i, (k, t) in enumerate(toks):
        if k == "ident":
            low = t.lower()
            if low in ("now", "current_date", "current_timestamp", "localtimestamp", "current_time"):
                return True
    return False


# ---------------------------------------------------------------------------------------------
# Grafana variable interpolation (Grafana 11 templateSrv.replace + SQL datasource formatter)
# ---------------------------------------------------------------------------------------------

_VAR_RE = re.compile(
    r"\$(\w+)|\[\[(\w+?)(?::(\w+))?\]\]|\$\{(\w+)(?:\.([^:^\}]+))?(?::([^\}]+))?\}"
)
ALL_VALUE = "$__all"


def extract_variable_refs(text: str) -> List[str]:
    names: List[str] = []
    for m in _VAR_RE.finditer(text or ""):
        name = m.group(1) or m.group(2) or m.group(4)
        if name and name not in names and not name.startswith("__"):
            names.append(name)
    return names


def default_values(var_defs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Current (saved) value of each variable definition."""
    out: Dict[str, Any] = {}
    for name, v in var_defs.items():
        cur = (v.get("current") or {}).get("value")
        if cur == ALL_VALUE and not v.get("includeAll"):
            continue  # stale saved value; Grafana falls back to the first option
        if cur is not None:
            out[name] = cur
    return out


def _quote_literal(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


def _format_value(value: Any, fmt: Optional[str], var: Dict[str, Any], *, escape_single_quotes: bool = True) -> str:
    """Grafana ``formatVariableValue``.  ``fmt`` None => SQL datasource formatter."""
    if fmt is None:
        # @grafana/sql SqlDatasource.interpolateVariable
        if isinstance(value, str):
            if var.get("multi") or var.get("includeAll"):
                return _quote_literal(value)
            return value.replace("'", "''") if escape_single_quotes else value
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
        return ",".join(_quote_literal(v) for v in value)
    vals = value if isinstance(value, list) else [value]
    if fmt in ("raw", "value"):
        return ",".join(str(v) for v in vals) if isinstance(value, list) else str(value)
    if fmt == "csv":
        return ",".join(str(v) for v in vals)
    if fmt == "pipe":
        return "|".join(str(v) for v in vals)
    if fmt == "json":
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if fmt == "sqlstring":
        return ",".join(_quote_literal(v) for v in vals)
    if fmt == "singlequote":
        return ",".join("'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'" for v in vals)
    if fmt == "doublequote":
        return ",".join('"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"' for v in vals)
    if fmt == "regex":
        esc = [re.sub(r"[.*+?^${}()|\[\]\\/]", lambda m: "\\" + m.group(0), str(v)) for v in vals]
        return "(" + "|".join(esc) + ")" if isinstance(value, list) else esc[0]
    if fmt == "glob":
        return "{" + ",".join(str(v) for v in vals) + "}" if isinstance(value, list) and len(vals) > 1 else str(vals[0])
    if fmt == "percentencode":
        from urllib.parse import quote
        return quote(",".join(str(v) for v in vals), safe="!~*'()")
    if fmt == "text":
        return " + ".join(str(v) for v in vals)
    raise NotImplementedError(f"variable format ${{{var.get('name')}:{fmt}}}")


def interpolate(text: str, var_defs: Dict[str, Dict[str, Any]], values: Dict[str, Any],
                *, escape_single_quotes: bool = True) -> str:
    """Grafana 11 ``templateSrv.replace`` for SQL targets.

    ``var_defs``: name -> definition dict (type/multi/includeAll/allValue/...).  ``values``: name ->
    selected value (str, or list[str] for multi).  Unknown variables are left verbatim, exactly as Grafana does.
    """
    def repl(m: "re.Match[str]") -> str:
        name = m.group(1) or m.group(2) or m.group(4)
        fmt = m.group(3) or m.group(6)
        if name not in var_defs and name not in values:
            return m.group(0)
        var = dict(var_defs.get(name) or {})
        var.setdefault("name", name)
        if name not in values:
            return m.group(0)
        value = values[name]
        is_all = value == ALL_VALUE or (isinstance(value, list) and value == [ALL_VALUE])
        if is_all:
            if var.get("allValue"):
                # custom all value: Grafana returns it unformatted (then re-interpolates it)
                if fmt in ("text", "queryparam"):
                    return str(var["allValue"])
                return interpolate(str(var["allValue"]), var_defs, values, escape_single_quotes=escape_single_quotes)
            options = var.get("_all_options")
            if options is None:
                raise ValueError(f"variable {name!r}: $__all without allValue needs _all_options")
            value = list(options)
        return _format_value(value, fmt, var, escape_single_quotes=escape_single_quotes)

    return _VAR_RE.sub(repl, text)


# ---------------------------------------------------------------------------------------------
# Grafana SQL macros (none occur in the archive; fail loudly instead of passing them through)
# ---------------------------------------------------------------------------------------------

_MACRO_RE = re.compile(r"\$__(\w+)(?:\(([^)]*)\))?")


def expand_macros(sql: str, time_from: Optional[_dt.datetime] = None, time_to: Optional[_dt.datetime] = None,
                  interval_seconds: int = 60) -> str:
    def lit(d: _dt.datetime) -> str:
        return "'" + d.strftime("%Y-%m-%dT%H:%M:%SZ") + "'"

    def repl(m: "re.Match[str]") -> str:
        name, arg = m.group(1), (m.group(2) or "").strip()
        if name == "all":
            return m.group(0)
        if time_from is None or time_to is None and name.startswith(("time", "unix")):
            raise ValueError(f"macro $__{name} needs a time range")
        if name == "timeFilter":
            return f"{arg} BETWEEN {lit(time_from)} AND {lit(time_to)}"
        if name == "timeFrom":
            return lit(time_from)
        if name == "timeTo":
            return lit(time_to)
        if name == "unixEpochFilter":
            return f"{arg} >= {int(time_from.timestamp())} AND {arg} <= {int(time_to.timestamp())}"
        if name == "interval":
            return f"{interval_seconds}s"
        if name in ("timeGroup", "timeGroupAlias"):
            col = arg.split(",")[0].strip()
            expr = f"floor(extract(epoch from {col})/{interval_seconds})*{interval_seconds}"
            return expr + (" AS \"time\"" if name == "timeGroupAlias" else "")
        raise NotImplementedError(f"macro $__{name}")

    return _MACRO_RE.sub(repl, sql)


# ---------------------------------------------------------------------------------------------
# Custom variable option parsing (Grafana scenes CustomVariable)
# ---------------------------------------------------------------------------------------------

def parse_custom_options(query: str) -> List[Dict[str, str]]:
    """``"P : a;b, TG : c"`` -> [{"text": "P", "value": "a;b"}, ...] (``\\,`` escapes a comma)."""
    out = []
    for piece in re.findall(r"(?:\\,|[^,])+", query or ""):
        piece = piece.replace("\\,", ",")
        m = re.match(r"^\s*(.+)\s:\s(.+)$", piece, re.S)
        if m:
            out.append({"text": m.group(1).strip(), "value": m.group(2).strip()})
        else:
            out.append({"text": piece.strip(), "value": piece.strip()})
    return out


# ---------------------------------------------------------------------------------------------
# DuckDB session / execution
# ---------------------------------------------------------------------------------------------

def _dataset(dataset: Any) -> Dict[str, str]:
    if isinstance(dataset, str):
        return DATASETS[dataset]
    return dataset


def ensure_session(con, dataset: Any):
    """Return a cursor configured for ``dataset``: search_path, PG null ordering, anchor macros."""
    ds = _dataset(dataset)
    cur = con.cursor()
    cur.execute("SET default_null_order='nulls_last_on_asc_first_on_desc'")
    cur.execute(f"SET search_path='{ds['schema']}'")  # a table missing from the dataset schema must error, not fall back to main
    ts = ds["anchor"]
    for _, ddl in MACROS:
        cur.execute(ddl.format(anchor_ts=ts, anchor_date=ts[:10]))
    return cur


def _col_type(duck_type: Any) -> str:
    s = str(duck_type).upper()
    if s.startswith(("TIMESTAMP", "DATE")):
        return "time"
    if s.startswith(("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UBIGINT", "UINTEGER", "USMALLINT",
                     "UTINYINT", "UHUGEINT", "DOUBLE", "FLOAT", "DECIMAL", "REAL")):
        return "number"
    if s.startswith("VARCHAR") or s.startswith("TEXT"):
        return "string"
    if s.startswith("BOOL"):
        return "boolean"
    return "other"


def _rows_to_frame(cur, ref_id: Optional[str]) -> Dict[str, Any]:
    desc = cur.description
    rows = [list(r) for r in cur.fetchall()]
    return {
        "refId": ref_id, "name": None,
        "columns": [{"name": d[0], "type": _col_type(d[1]), "labels": None} for d in desc],
        "rows": rows,
    }


def _render_sql(sql: str, entry: Dict[str, Any], variables: Optional[Dict[str, Any]], ds: Dict[str, str],
                time_range=None) -> str:
    defs = entry.get("variable_defs") or {}
    values = default_values(defs)
    values.update(variables or {})
    sql = interpolate(sql, defs, values)
    if time_range:
        sql = expand_macros(sql, *time_range)
    return sql


# ---------------------------------------------------------------------------------------------
# Transformations
# ---------------------------------------------------------------------------------------------

def _col_index(frame: Dict[str, Any], name: str) -> int:
    for i, c in enumerate(frame["columns"]):
        if c["name"] == name:
            return i
    return -1


def _filter_match(v: Any, cid: str, opts: Dict[str, Any]) -> bool:
    if cid == "isNull":
        return v is None
    if cid == "isNotNull":
        return v is not None
    o = opts or {}
    if v is None:
        return False
    if cid == "regex":
        return re.search(str(o.get("value", "")), str(v)) is not None
    val = o.get("value")
    try:
        if cid == "equal":
            return v == val or str(v) == str(val)
        if cid == "notEqual":
            return not (v == val or str(v) == str(val))
        if cid == "greater":
            return v > val
        if cid == "greaterOrEqual":
            return v >= val
        if cid == "lower":
            return v < val
        if cid == "lowerOrEqual":
            return v <= val
        if cid == "range":
            return o.get("from") <= v <= o.get("to")
    except TypeError:
        return False
    raise NotImplementedError(f"filterByValue matcher {cid}")


def _t_filter_by_value(frames, opts):
    filters = opts.get("filters") or []
    if not filters:
        return frames
    include = opts.get("type", "include") == "include"
    match_any = opts.get("match", "any") == "any"
    out = []
    for f in frames:
        usable = [(fl, _col_index(f, fl.get("fieldName"))) for fl in filters]
        usable = [(fl, ix) for fl, ix in usable if ix >= 0]
        if not usable:
            out.append(f); continue
        keep = []
        for row in f["rows"]:
            hits = [_filter_match(row[ix], fl["config"]["id"], fl["config"].get("options")) for fl, ix in usable]
            ok = any(hits) if match_any else all(hits)
            if ok == include:
                keep.append(row)
        out.append({**f, "rows": keep})
    return out


def _binary_operand(f, spec, row):
    if isinstance(spec, dict) and "matcher" in spec:
        name = spec["matcher"]["options"]
        ix = _col_index(f, name)
        return (row[ix] if ix >= 0 else None), ix >= 0
    if isinstance(spec, dict) and "fixed" in spec:
        return float(spec["fixed"]), True
    return spec, True


def _t_calculate_field(frames, opts):
    mode = opts.get("mode", "reduceRow")
    alias = opts.get("alias")
    out = []
    for f in frames:
        f2 = {**f, "columns": [dict(c) for c in f["columns"]], "rows": [list(r) for r in f["rows"]]}
        if mode == "index":
            name = alias or "Row"
            f2["columns"].append({"name": name, "type": "number", "labels": None})
            for i, r in enumerate(f2["rows"]):
                r.append(i)
        elif mode == "binary":
            b = opts.get("binary") or {}
            name = alias or "binary"
            ok_all = True
            vals = []
            for r in f["rows"]:
                lv, lok = _binary_operand(f, b.get("left"), r)
                rv, rok = _binary_operand(f, b.get("right"), r)
                ok_all = ok_all and lok and rok
                if lv is None or rv is None:
                    vals.append(None); continue
                op = b.get("operator", "+")
                try:
                    lv, rv = float(lv), float(rv)
                    vals.append({"+": lv + rv, "-": lv - rv, "*": lv * rv, "/": (lv / rv if rv else None),
                                 "%": (lv % rv if rv else None)}[op])
                except (KeyError, TypeError):
                    vals.append(None)
            if not ok_all and f["rows"]:
                out.append(f); continue  # Grafana: unresolved operand => frame unchanged
            f2["columns"].append({"name": name, "type": "number", "labels": None})
            for r, v in zip(f2["rows"], vals):
                r.append(v)
        elif mode == "reduceRow":
            red = (opts.get("reduce") or {}).get("reducer", "sum")
            include = (opts.get("reduce") or {}).get("include") or []
            ixs = [i for i, c in enumerate(f["columns"]) if c["type"] == "number" and (not include or c["name"] in include)]
            name = alias or red
            f2["columns"].append({"name": name, "type": "number", "labels": None})
            for r in f2["rows"]:
                nums = [r[i] for i in ixs if r[i] is not None]
                if red == "sum":
                    v = sum(nums) if nums else 0
                elif red == "count":
                    v = len(nums)
                elif red == "mean":
                    v = (sum(nums) / len(nums)) if nums else None
                elif red == "min":
                    v = min(nums) if nums else None
                elif red == "max":
                    v = max(nums) if nums else None
                else:
                    raise NotImplementedError(f"reduceRow reducer {red}")
                r.append(v)
        else:
            raise NotImplementedError(f"calculateField mode {mode}")
        if opts.get("replaceFields"):
            keep = [len(f2["columns"]) - 1]
            f2["columns"] = [f2["columns"][i] for i in keep]
            f2["rows"] = [[r[i] for i in keep] for r in f2["rows"]]
        out.append(f2)
    return out


def _t_organize(frames, opts):
    exclude = opts.get("excludeByName") or {}
    rename = opts.get("renameByName") or {}
    order = opts.get("indexByName") or {}
    out = []
    for f in frames:
        idx = [i for i, c in enumerate(f["columns"]) if not exclude.get(c["name"])]
        if order:
            idx.sort(key=lambda i: order.get(f["columns"][i]["name"], 10 ** 6 + i))
        cols = []
        for i in idx:
            c = dict(f["columns"][i])
            to = rename.get(c["name"])
            if to:  # empty string = no rename (Grafana: falsy)
                c["name"] = to
            cols.append(c)
        out.append({**f, "columns": cols, "rows": [[r[i] for i in idx] for r in f["rows"]]})
    return out


def _t_prepare_time_series(frames, opts):
    fmt = opts.get("format", "wide")
    if fmt != "multi":
        raise NotImplementedError(f"prepareTimeSeries format {fmt}")
    out = []
    for f in frames:
        tix = next((i for i, c in enumerate(f["columns"]) if c["type"] == "time"), -1)
        if tix < 0:
            out.append(f); continue
        label_ix = [i for i, c in enumerate(f["columns"]) if c["type"] == "string"]
        value_ix = [i for i, c in enumerate(f["columns"]) if c["type"] == "number"]
        groups: Dict[Tuple, List[List[Any]]] = {}
        for r in f["rows"]:
            groups.setdefault(tuple(r[i] for i in label_ix), []).append(r)
        for key, rows in groups.items():
            labels = {f["columns"][i]["name"]: key[j] for j, i in enumerate(label_ix)}
            cols = [dict(f["columns"][tix])] + [{**f["columns"][i], "labels": labels or None} for i in value_ix]
            out.append({**f, "columns": cols, "rows": [[r[tix]] + [r[i] for i in value_ix] for r in rows],
                        "name": None})
    return out


def _t_labels_to_fields(frames, opts):
    """mode=columns, no valueLabel: label values name the value columns; frames are joined on time."""
    if opts.get("mode", "columns") != "columns":
        raise NotImplementedError("labelsToFields mode rows")
    groups = [f for f in frames if any(c.get("labels") for c in f["columns"])]
    if not groups:
        return frames
    others = [f for f in frames if f not in groups]
    names: List[str] = []
    table: Dict[Any, Dict[str, Any]] = {}
    times: List[Any] = []
    for f in groups:
        tix = next((i for i, c in enumerate(f["columns"]) if c["type"] == "time"), -1)
        for vi, c in enumerate(f["columns"]):
            if vi == tix:
                continue
            nm = " ".join(str(v) for v in (c.get("labels") or {}).values()) or c["name"]
            if nm not in names:
                names.append(nm)
            for r in f["rows"]:
                t = r[tix]
                if t not in table:
                    table[t] = {}
                    times.append(t)
                table[t][nm] = r[vi]  # duplicate (time, label) rows: last one wins
    times.sort()
    cols = [{"name": "time", "type": "time", "labels": None}] + [{"name": n, "type": "number", "labels": None} for n in names]
    rows = [[t] + [table[t].get(n) for n in names] for t in times]
    return [{"refId": groups[0]["refId"], "name": None, "columns": cols, "rows": rows}] + others


def _t_join_by_field(frames, opts):
    if len(frames) <= 1:
        return frames  # single frame: nothing to join
    by = opts.get("byField")
    mode = opts.get("mode", "outer")
    base = frames[0]
    bix = _col_index(base, by)
    if bix < 0:
        return frames
    cols = [dict(c) for c in base["columns"]]
    rows = [list(r) for r in base["rows"]]
    keys = {r[bix]: i for i, r in enumerate(rows)}
    for f in frames[1:]:
        fix = _col_index(f, by)
        if fix < 0:
            continue
        extra = [i for i in range(len(f["columns"])) if i != fix]
        cols.extend(dict(f["columns"][i]) for i in extra)
        width_before = len(cols) - len(extra)
        for r in rows:
            r.extend([None] * len(extra))
        for fr in f["rows"]:
            k = fr[fix]
            if k in keys:
                row = rows[keys[k]]
                for j, i in enumerate(extra):
                    row[width_before + j] = fr[i]
            elif mode in ("outer", "outerTabular"):
                new = [None] * len(cols)
                new[bix] = k
                for j, i in enumerate(extra):
                    new[width_before + j] = fr[i]
                keys[k] = len(rows); rows.append(new)
    return [{**base, "columns": cols, "rows": rows}]


def _t_group_by(frames, opts):
    if not opts or not any((v or {}).get("operation") for v in (opts.get("fields") or {}).values()):
        return frames  # no configured fields: Grafana returns data unchanged
    raise NotImplementedError("groupBy with configured fields")


_TRANSFORMS: Dict[str, Callable] = {
    "filterByValue": _t_filter_by_value,
    "calculateField": _t_calculate_field,
    "organize": _t_organize,
    "prepareTimeSeries": _t_prepare_time_series,
    "labelsToFields": _t_labels_to_fields,
    "joinByField": _t_join_by_field,
    "groupBy": _t_group_by,
}


def apply_transformations(frames: List[Dict[str, Any]], transformations: Sequence[Dict[str, Any]]):
    for t in transformations or []:
        if t.get("disabled"):
            continue
        fn = _TRANSFORMS.get(t["id"])
        if fn is None:
            raise NotImplementedError(f"transformation {t['id']}")
        frames = fn(frames, t.get("options") or {})
    return frames


# ---------------------------------------------------------------------------------------------
# time_series format (sqlds long -> wide with labels)
# ---------------------------------------------------------------------------------------------

def _to_time_series(frame: Dict[str, Any]) -> Dict[str, Any]:
    """Grafana SQL ``format=time_series``: string columns become labels (long -> multi frames)."""
    tix = next((i for i, c in enumerate(frame["columns"]) if c["type"] == "time"), -1)
    if tix < 0 or not any(c["type"] == "string" for c in frame["columns"]):
        return frame
    multi = _t_prepare_time_series([frame], {"format": "multi"})
    return multi  # list of frames


# ---------------------------------------------------------------------------------------------
# Public runners
# ---------------------------------------------------------------------------------------------

def run_panel(con, registry_entry: Dict[str, Any], variables: Optional[Dict[str, Any]], dataset: Any,
              *, include_hidden: bool = False, apply_transforms: bool = True, time_range=None) -> List[Dict[str, Any]]:
    """Run every (visible) target of a panel on DuckDB, then its transformations.

    ``variables``: overrides for dashboard variables (name -> str | list[str]); missing ones use the
    saved ``current`` value.  Returns a list of frames.
    """
    ds = _dataset(dataset)
    cur = ensure_session(con, ds)
    frames: List[Dict[str, Any]] = []
    try:
        for tgt in registry_entry.get("targets", []):
            sql = tgt.get("duckdb_sql")
            if not sql or tgt.get("excluded"):
                continue
            if tgt.get("hide") and not include_hidden:
                continue
            sql = _render_sql(sql, registry_entry, variables, ds, time_range)
            cur.execute(sql)
            frame = _rows_to_frame(cur, tgt.get("refId"))
            if tgt.get("format") == "time_series":
                res = _to_time_series(frame)
                frames.extend(res if isinstance(res, list) else [res])
            else:
                frames.append(frame)
    finally:
        cur.close()
    if apply_transforms:
        frames = apply_transformations(frames, registry_entry.get("transformations"))
    return frames


def run_variable_query(con, var_entry: Dict[str, Any], dataset: Any, values: Optional[Dict[str, Any]] = None,
                       var_defs: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, str]]:
    """Execute a query-type variable on DuckDB -> [{"text","value"}] (Grafana __text/__value rules)."""
    ds = _dataset(dataset)
    cur = ensure_session(con, ds)
    try:
        defs = var_defs or {}
        sql = interpolate(var_entry["duckdb_query"], defs, values or {})
        cur.execute(sql)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
    finally:
        cur.close()
    low = [c.lower() for c in cols]
    if "__text" in low or "__value" in low:
        ti = low.index("__text") if "__text" in low else low.index("__value")
        vi = low.index("__value") if "__value" in low else ti
    else:
        ti = vi = 0
    out = []
    for r in rows:
        if r[vi] is None:
            continue
        out.append({"text": str(r[ti]), "value": str(r[vi])})
    return out


def resolve_variable_options(con, var_entry: Dict[str, Any], dataset: Any, values: Optional[Dict[str, Any]] = None,
                             var_defs: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, str]]:
    """Options for any variable type (custom / query)."""
    if var_entry.get("type") == "custom":
        return parse_custom_options(var_entry.get("query", ""))
    if var_entry.get("type") == "query":
        if not var_entry.get("duckdb_query"):
            return []
        return sort_variable_options(run_variable_query(con, var_entry, dataset, values, var_defs), var_entry.get("sort") or 0)
    return list(var_entry.get("options") or [])


def _jsonable(v: Any) -> Any:
    if isinstance(v, _dt.datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, _dt.date):
        return v.isoformat()
    if isinstance(v, _decimal.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    return v


def frames_to_jsonable(frames: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{**f, "rows": [[_jsonable(c) for c in r] for r in f["rows"]]} for f in frames]


def sort_variable_options(options: List[Dict[str, str]], sort: int = 0) -> List[Dict[str, str]]:
    """Grafana variable ``sort`` setting (0 none, 1/2 alpha asc/desc, 3/4 numeric, 5/6 alpha case-insensitive, 7/8 natural).

    Note Grafana re-sorts the SQL result (ORDER BY in the query is only the starting order)."""
    if not sort:
        return list(options)
    def num(o):
        m = re.search(r"-?\d+(?:\.\d+)?", o["text"])
        return float(m.group(0)) if m else 0.0
    def nat(o):
        return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", o["text"])]
    keyfn = {1: lambda o: o["text"], 2: lambda o: o["text"], 3: num, 4: num,
             5: lambda o: o["text"].lower(), 6: lambda o: o["text"].lower(), 7: nat, 8: nat}[sort]
    return sorted(options, key=keyfn, reverse=sort in (2, 4, 6, 8))
