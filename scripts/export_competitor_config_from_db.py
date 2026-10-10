"""Regenerate config/competitor_playlists.csv from competitor.playlists.

The database is the source of truth for competitor pipeline config: labels and
playlists are added from the /competitors "Add competitor" form. The competitor
workflows run this before refresh / dashboard sync / export so the Playwright
and ingestion scripts (which read the CSV) pick up UI-added playlists without a
commit.

Transition safety:
- A committed row is removed only when its received DB playlist explicitly
  has is_active = false. Missing playlists/labels preserve committed rows and
  warn. Fewer DB playlists than committed rows causes whole-snapshot fallback.
- Both DB tables are paged with exact counts and verified Content-Range totals.
- If the database can't be read (or returns no active playlists), the
  committed CSV is left untouched and the script exits 0 unless --strict.

Usage:
  python scripts/export_competitor_config_from_db.py                # rewrite in place
  python scripts/export_competitor_config_from_db.py --check        # diff DB vs CSV, exit 1 on drift
  python scripts/export_competitor_config_from_db.py --out /tmp/x.csv
"""

import argparse
import csv
import io
import os
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from streambase_postgrest import Postgrest

HEADER = [
    "playlist_key",
    "display_name",
    "label_key",
    "is_catalog",
    "playlist_type",
    "dashboard_url",
    "sot_playlist_id",
    "sot_dashboard_name",
    "min_rows",
]


def read_csv_rows(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return [{k: (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f)]


def db_row_to_csv(playlist: dict) -> Dict[str, str]:
    display_name = str(playlist.get("display_name") or "").strip()
    sot_id = playlist.get("sot_playlist_id")
    min_rows = playlist.get("min_rows")
    return {
        "playlist_key": str(playlist["playlist_key"]).strip(),
        "display_name": display_name,
        "label_key": str(playlist.get("label_key") or "").strip(),
        "is_catalog": "true",
        "playlist_type": "Competitor",
        "dashboard_url": str(playlist.get("sot_dashboard_url") or "").strip(),
        "sot_playlist_id": "" if sot_id is None else str(sot_id),
        "sot_dashboard_name": str(playlist.get("sot_dashboard_name") or "").strip() or display_name,
        "min_rows": "1" if min_rows is None else str(int(min_rows)),
    }


def build_rows(
    db_playlists: List[dict],
    active_labels: set,
    committed: List[Dict[str, str]],
) -> Tuple[List[Dict[str, str]], List[str]]:
    """Merge DB playlists with committed CSV rows. Returns (rows, warnings)."""
    warnings: List[str] = []
    known_keys = {str(p.get("playlist_key") or "").strip() for p in db_playlists}
    committed_by_key = {r.get("playlist_key", ""): r for r in committed}

    rows: List[Dict[str, str]] = []
    for p in db_playlists:
        key = str(p.get("playlist_key") or "").strip()
        prev = committed_by_key.get(key)
        if p.get("is_active") is False:
            continue
        label_key = str(p.get("label_key") or "")
        if label_key not in active_labels:
            if prev:
                rows.append(dict(prev))
                warnings.append(f"{key}: label {label_key} absent/inactive in DB response; kept committed CSV row")
            else:
                warnings.append(f"{key}: label {label_key} absent/inactive in DB response; skipped new playlist")
            continue
        row = db_row_to_csv(p)
        # Preserve CSV-only knobs the DB doesn't model (e.g. allow_empty).
        if prev:
            for k, v in prev.items():
                if k not in row and v:
                    row[k] = v
        if not row["dashboard_url"]:
            raise ValueError(f"{row['playlist_key']}: no SpotOnTrack dashboard URL in DB")
        rows.append(row)

    for r in committed:
        key = r.get("playlist_key", "")
        if key and key not in known_keys:
            warnings.append(f"{key}: in committed CSV but not in competitor.playlists response; kept committed CSV row")
            rows.append(dict(r))
    # Keep snapshot order even if the DB returns rows in another order. Append
    # new playlists in the stable order supplied by load_from_db.
    positions = {r["playlist_key"]: i for i, r in enumerate(committed)}
    rows.sort(key=lambda r: positions.get(r["playlist_key"], len(positions)))
    return rows, warnings


def render_csv(rows: List[Dict[str, str]], lineterminator: str = "\n") -> str:
    extra = sorted({k for r in rows for k in r} - set(HEADER))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=HEADER + extra, lineterminator=lineterminator, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: r.get(k, "") for k in HEADER + extra})
    return buf.getvalue()


def diff_keys(a: List[Dict[str, str]], b: List[Dict[str, str]]) -> List[str]:
    """Human-readable differences between committed (a) and generated (b)."""
    out: List[str] = []
    a_by = {r.get("playlist_key"): r for r in a}
    b_by = {r.get("playlist_key"): r for r in b}
    for k in sorted(set(b_by) - set(a_by)):
        out.append(f"+ {k} (in DB, not in committed CSV)")
    for k in sorted(set(a_by) - set(b_by)):
        out.append(f"- {k} (in committed CSV, inactive/missing in DB)")
    for k in sorted(set(a_by) & set(b_by)):
        changed = [c for c in HEADER if (a_by[k].get(c) or "") != (b_by[k].get(c) or "")]
        if changed:
            out.append(f"~ {k}: {', '.join(changed)}")
    return out


def load_from_db(pg: Postgrest) -> Tuple[List[dict], set]:
    playlists = pg.select_all(
        "playlists",
        "playlist_key,label_key,display_name,sot_playlist_id,sot_dashboard_url,sot_dashboard_name,min_rows,"
        "display_order,is_active,created_at",
        "playlist_key=not.is.null",
        order="created_at.asc,playlist_key.asc",
        require_exact_count=True,
    )
    labels = pg.select_all("labels", "label_key,is_active", "label_key=not.is.null", order="label_key.asc",
                           require_exact_count=True)
    if len({p["playlist_key"] for p in playlists}) != len(playlists):
        raise ValueError("Duplicate playlist identities in DB response")
    if len({label["label_key"] for label in labels}) != len(labels):
        raise ValueError("Duplicate label identities in DB response")
    active_labels = {str(l["label_key"]) for l in labels if l.get("is_active", True)}
    return playlists, active_labels


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--csv", default="config/competitor_playlists.csv", help="Committed CSV to merge with")
    ap.add_argument("--out", default=None, help="Output path (default: overwrite --csv)")
    ap.add_argument("--check", action="store_true", help="Only report drift; exit 1 if the CSV is out of date")
    ap.add_argument("--strict", action="store_true", help="Fail instead of falling back to the committed CSV")
    args = ap.parse_args(argv)

    committed = read_csv_rows(args.csv)
    try:
        url = os.environ["SUPABASE_URL"].strip()
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"].strip()
        if not url or not key:
            raise ValueError("Missing Supabase credentials")
        pg = Postgrest(url, key, schema="competitor", timeout_s=15, max_retries=1)
        db_playlists, active_labels = load_from_db(pg)
        rows, warnings = build_rows(db_playlists, active_labels, committed)
        # Render before touching the snapshot: malformed DB values also fall back.
        original = Path(args.csv).read_bytes() if Path(args.csv).exists() else b"\xef\xbb\xbf"
        newline = "\r\n" if b"\r\n" in original else "\n"
        encoding = "utf-8-sig" if original.startswith(b"\xef\xbb\xbf") else "utf-8"
        generated = render_csv(rows, newline).encode(encoding)
    except Exception as e:  # keep pipelines running on the committed CSV
        # Avoid echoing DB response bodies / URLs into public workflow logs.
        msg = f"Could not read competitor config from DB ({type(e).__name__})"
        if args.strict or args.check:
            print(f"❌ {msg}")
            return 2
        print(f"⚠️ {msg}; using committed {args.csv} unchanged.")
        return 0

    for w in warnings:
        print(f"⚠️ {w}")
    if len(db_playlists) < len(committed):
        print(f"DB returned fewer playlists ({len(db_playlists)}) than committed CSV ({len(committed)}); "
              f"using committed {args.csv} unchanged.")
        return 2 if args.strict or args.check else 0
    if not rows:
        msg = "DB returned no active competitor playlists"
        if args.strict or args.check:
            print(f"❌ {msg}")
            return 2
        print(f"⚠️ {msg}; using committed {args.csv} unchanged.")
        return 0

    changes = diff_keys(committed, rows)
    if args.check:
        if changes:
            print(f"{args.csv} differs from competitor.playlists:")
            print("\n".join(changes))
            print("Run: python scripts/export_competitor_config_from_db.py  (then commit the CSV)")
            return 1
        print(f"{args.csv} matches competitor.playlists ({len(rows)} playlists).")
        return 0

    out = args.out or args.csv
    # Atomic replacement leaves the committed snapshot intact if writing fails.
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(dir=Path(out).parent, delete=False) as f:
            temp_path = f.name
            f.write(generated)
        os.replace(temp_path, out)
    except OSError as e:
        print(f"Could not write competitor config ({type(e).__name__}); using {args.csv} unchanged.")
        return 2 if args.strict else 0
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)
    print(f"Wrote {len(rows)} competitor playlists to {out}.")
    if changes:
        print("Changes vs committed CSV:\n" + "\n".join(changes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
