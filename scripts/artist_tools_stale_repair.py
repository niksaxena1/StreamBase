"""
Prepare and apply manual stale-track overrides sourced from artist.tools.

This helper intentionally does not fetch stream counts. artist.tools remains the
human-visible source of truth; the script only handles deterministic plumbing.
For historical tooltip repairs, artist.tools dates align to the SpotiBase run
date, not the shifted UI data date. If a target-date tooltip is missing, ask
the user before applying interpolation or another anchor.

The script handles:

1. discover the latest stale-track warning,
2. exclude tracks already overridden for the target run date,
3. attach Spotify track IDs,
4. emit a JSON worklist for browser verification,
5. apply a reviewed JSON results file as overrides,
6. run the cascade recompute once after the batch.

Usage:
    python scripts/artist_tools_stale_repair.py prepare --date 2026-05-19 --limit 50
    python scripts/artist_tools_stale_repair.py apply --date 2026-05-19 --results .tmp/artist_tools_results.json
    python scripts/artist_tools_stale_repair.py verify --date 2026-05-19 --results .tmp/artist_tools_results.json
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import requests


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.rest_base = supabase_url.rstrip("/") + "/rest/v1"
        self.rpc_base = supabase_url.rstrip("/") + "/rest/v1/rpc"
        self.headers = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
        }

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        r = requests.get(f"{self.rest_base}/{table}", headers=self.headers, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> list[dict[str, Any]]:
        headers = dict(self.headers)
        headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        r = requests.post(
            f"{self.rest_base}/{table}",
            headers=headers,
            params={"on_conflict": on_conflict},
            data=json.dumps(rows),
            timeout=60,
        )
        r.raise_for_status()
        return r.json()

    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        r = requests.post(
            f"{self.rpc_base}/{name}",
            headers=self.headers,
            data=json.dumps(payload),
            timeout=60,
        )
        r.raise_for_status()
        return r.text


def load_envlocal_if_present() -> None:
    env_path = Path("web/.env.local")
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


def client() -> Postgrest:
    load_envlocal_if_present()
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    return Postgrest(supabase_url, service_role_key)


def latest_stale_tracks(pg: Postgrest) -> tuple[str, list[dict[str, Any]]]:
    rows = pg.select(
        "ingestion_warnings",
        {
            "select": "run_date,details_json",
            "code": "eq.individual_tracks_stale",
            "order": "run_date.desc",
            "limit": "1",
        },
    )
    if not rows:
        raise SystemExit("No individual_tracks_stale warning found.")
    row = rows[0]
    details = row.get("details_json") or {}
    return str(row["run_date"]), list(details.get("affected_tracks") or [])


def existing_overrides(pg: Postgrest, run_date: str) -> set[str]:
    rows = pg.select(
        "track_daily_stream_overrides",
        {"select": "isrc", "date": f"eq.{run_date}"},
    )
    return {str(r["isrc"]).strip().upper() for r in rows}


def track_meta(pg: Postgrest, isrcs: list[str]) -> dict[str, dict[str, Any]]:
    if not isrcs:
        return {}
    rows = pg.select(
        "tracks",
        {
            "select": "isrc,name,spotify_track_id,spotify_artist_names",
            "isrc": f"in.({','.join(isrcs)})",
        },
    )
    return {str(r["isrc"]).strip().upper(): r for r in rows}


def prepare(args: argparse.Namespace) -> None:
    pg = client()
    warning_date, stale = latest_stale_tracks(pg)
    target_date = args.date or warning_date
    overridden = existing_overrides(pg, target_date)
    remaining = [r for r in stale if str(r.get("isrc", "")).strip().upper() not in overridden]
    if args.limit:
        remaining = remaining[: args.limit]
    meta = track_meta(pg, [str(r["isrc"]).strip().upper() for r in remaining])

    worklist: list[dict[str, Any]] = []
    for row in remaining:
        isrc = str(row["isrc"]).strip().upper()
        t = meta.get(isrc, {})
        worklist.append(
            {
                "run_date": target_date,
                "isrc": isrc,
                "name": t.get("name"),
                "spotify_artist_names": t.get("spotify_artist_names"),
                "spotify_track_id": t.get("spotify_track_id"),
                "artist_tools_url": (
                    f"https://app.artist.tools/track/{t.get('spotify_track_id')}"
                    if t.get("spotify_track_id")
                    else None
                ),
                "previous_streams_cumulative": row.get("streams_cumulative"),
                "avg_daily_7d": row.get("avg_daily_7d"),
            }
        )

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(worklist, indent=2), encoding="utf-8")
    if args.results_template:
        template = [{"isrc": row["isrc"], "streams": ""} for row in worklist]
        results_out = Path(args.results_template)
        results_out.parent.mkdir(parents=True, exist_ok=True)
        results_out.write_text(json.dumps(template, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "warning_date": warning_date,
                "target_date": target_date,
                "prepared": len(worklist),
                "missing_spotify_track_ids": sum(1 for r in worklist if not r["spotify_track_id"]),
                "output": str(out),
                "results_template": args.results_template,
            },
            indent=2,
        )
    )


def apply(args: argparse.Namespace) -> None:
    pg = client()
    rows_in = json.loads(Path(args.results).read_text(encoding="utf-8"))
    target_date = args.date
    payload: list[dict[str, Any]] = []
    for row in rows_in:
        streams = row.get("streams")
        if isinstance(streams, str):
            streams = int(streams.replace(",", ""))
        if not isinstance(streams, int) or streams < 0:
            raise SystemExit(f"Invalid streams for {row.get('isrc')}: {row.get('streams')!r}")
        payload.append(
            {
                "date": target_date,
                "isrc": str(row["isrc"]).strip().upper(),
                "streams_cumulative_override": streams,
                "note": args.note,
            }
        )

    inserted = pg.upsert("track_daily_stream_overrides", payload, "date,isrc")
    recompute_response = pg.rpc(
        "spotibase_recompute_playlist_daily_stats_cascade",
        {"p_start_date": target_date},
    )
    print(json.dumps({"applied": len(inserted), "recompute_response": recompute_response}, indent=2))


def verify(args: argparse.Namespace) -> None:
    pg = client()
    warning_date, stale = latest_stale_tracks(pg)
    overridden = existing_overrides(pg, args.date)
    results = json.loads(Path(args.results).read_text(encoding="utf-8")) if args.results else []
    unresolved = [
        row for row in results
        if not str(row.get("streams", "")).strip()
    ]
    remaining = [
        row for row in stale
        if str(row.get("isrc", "")).strip().upper() not in overridden
    ]
    print(
        json.dumps(
            {
                "warning_date": warning_date,
                "target_date": args.date,
                "applied_for_date": len(overridden),
                "results_rows": len(results),
                "unresolved_results_rows": len(unresolved),
                "remaining_stale_without_override": len(remaining),
            },
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prepare")
    p.add_argument("--date")
    p.add_argument("--limit", type=int)
    p.add_argument("--output", default=".tmp/artist_tools_worklist.json")
    p.add_argument("--results-template")
    p.set_defaults(func=prepare)

    a = sub.add_parser("apply")
    a.add_argument("--date", required=True)
    a.add_argument("--results", required=True)
    a.add_argument(
        "--note",
        default="Manual override from artist.tools using direct artist.tools track page verification.",
    )
    a.set_defaults(func=apply)

    v = sub.add_parser("verify")
    v.add_argument("--date", required=True)
    v.add_argument("--results")
    v.set_defaults(func=verify)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
