"""Playlist Watch track streams: daily play counts for every track of selected playlists.

Separate from the follower collector and from all own-catalog/competitor pipelines. Writes only
playlist_watch.track_watch_* tables (migration 20261104174153). Docs: docs/PLAYLIST-WATCH-OPERATIONS.md.

Per active row of playlist_watch.track_watch_playlists:
  1. Read the playlist's tracks with the Spotify Web API (client credentials).
  2. Sync memberships: new tracks get first_seen_date = run date; tracks no longer in the playlist get
     removed_date = run date (a re-added track clears removed_date and keeps its first_seen_date).
  3. Fetch the play count (the number shown in the Spotify app) for current tracks plus removed tracks
     still inside removed_retention_days, from Spotify's web-player GraphQL endpoint using the anonymous
     token embedded in the public playlist embed page. No API keys or paid quota.
  4. Upsert one snapshot per (track, run date).

Usage:
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... \
        python scripts/collect_playlist_watch_track_streams.py [--dry-run] [--run-date YYYY-MM-DD]
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from streambase_postgrest import Postgrest  # noqa: E402

SCHEMA = "playlist_watch"
SOURCE = "spotify_web_player"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query"
# Persisted-query hash of the web player's getTrack operation. Spotify rotates these occasionally;
# override with PLAYCOUNT_QUERY_HASH (find the current one in open.spotify.com network traffic).
DEFAULT_GET_TRACK_HASH = "ae85b52abb74d20a4c331d4143d4772c95f34757bfa8c625474b912b9055b5c0"
TOKEN_RE = re.compile(r'"accessToken":"([^"]+)"')
TRACK_ID_RE = re.compile(r"^[A-Za-z0-9]{16,32}$")
REQUEST_TIMEOUT = 20
CALL_SPACING_S = 0.35
MAX_FAILURE_RATIO = 0.2


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


# ---------------------------------------------------------------- Spotify Web API (membership)

def spotify_api_token(client_id: str, client_secret: str) -> str:
    basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    r = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={"Authorization": f"Basic {basic}"},
        data={"grant_type": "client_credentials"},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def spotify_get(url: str, token: str, params: Optional[dict] = None) -> dict:
    for attempt in range(5):
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=REQUEST_TIMEOUT)
        if r.status_code == 429:
            wait = min(int(r.headers.get("Retry-After", "5") or 5), 60)
            print(f"[spotify] 429, waiting {wait}s")
            time.sleep(wait)
            continue
        if r.status_code >= 500 and attempt < 4:
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code >= 400:
            raise RuntimeError(f"Spotify GET {url} -> {r.status_code} {r.text[:200]}")
        return r.json()
    raise RuntimeError(f"Spotify GET {url} kept returning 429")


def fetch_playlist(playlist_id: str, token: str) -> Tuple[dict, List[dict]]:
    """Return (playlist meta, track items in playlist order). Local files and episodes are skipped."""
    meta = spotify_get(
        f"https://api.spotify.com/v1/playlists/{playlist_id}",
        token,
        {"fields": "name,owner(display_name),images,tracks(total)"},
    )
    items: List[dict] = []
    url = f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks"
    params: Optional[dict] = {
        "limit": 100,
        "fields": "next,items(added_at,is_local,track(type,id,name,external_ids(isrc),artists(name),"
        "album(name,release_date,images)))",
    }
    while url:
        page = spotify_get(url, token, params)
        items.extend(page.get("items") or [])
        url, params = page.get("next"), None
    return meta, items


def normalize_items(items: Iterable[dict]) -> List[dict]:
    """Playlist items -> track rows (first occurrence wins for duplicates), with 0-based position."""
    out: List[dict] = []
    seen = set()
    for item in items:
        track = item.get("track") or {}
        tid = track.get("id")
        if item.get("is_local") or track.get("type") != "track" or not tid or not TRACK_ID_RE.match(tid):
            continue
        if tid in seen:
            continue
        seen.add(tid)
        album = track.get("album") or {}
        images = album.get("images") or []
        # Smallest image >= 64px keeps the page light; fall back to whatever exists.
        image = None
        if images:
            sized = sorted((i for i in images if i.get("url")), key=lambda i: i.get("width") or 0)
            image = next((i["url"] for i in sized if (i.get("width") or 0) >= 64), sized[-1]["url"] if sized else None)
        out.append({
            "spotify_track_id": tid,
            "isrc": (track.get("external_ids") or {}).get("isrc"),
            "name": track.get("name"),
            "artists": ", ".join(a.get("name") for a in track.get("artists") or [] if a.get("name")),
            "album_name": album.get("name"),
            "image_url": image,
            "release_date": album.get("release_date"),
            "added_at": item.get("added_at"),
            "position": len(out),
        })
    return out


def plan_memberships(
    playlist_id: str, current: List[dict], existing: List[dict], run_date: str
) -> Tuple[List[dict], List[str]]:
    """Return (membership rows to upsert, track ids newly removed today)."""
    by_id = {row["spotify_track_id"]: row for row in existing}
    current_ids = set()
    upserts = []
    for t in current:
        tid = t["spotify_track_id"]
        current_ids.add(tid)
        prev = by_id.get(tid)
        upserts.append({
            "spotify_playlist_id": playlist_id,
            "spotify_track_id": tid,
            "added_at": t.get("added_at"),
            "first_seen_date": prev["first_seen_date"] if prev else run_date,
            "last_seen_date": run_date,
            "removed_date": None,
            "position": t["position"],
        })
    removed = [
        row["spotify_track_id"]
        for row in existing
        if row["spotify_track_id"] not in current_ids and not row.get("removed_date")
    ]
    return upserts, removed


def tracks_to_collect(current: List[dict], existing: List[dict], removed_today: List[str],
                      run_date: str, retention_days: int) -> List[str]:
    ids = [t["spotify_track_id"] for t in current]
    seen = set(ids)
    cutoff = (date.fromisoformat(run_date) - timedelta(days=retention_days)).isoformat()
    for row in existing:
        tid = row["spotify_track_id"]
        if tid in seen:
            continue
        removed = run_date if tid in removed_today else row.get("removed_date")
        if removed and removed >= cutoff:
            ids.append(tid)
            seen.add(tid)
    return ids


# ---------------------------------------------------------------- Web-player play counts

class PlaycountClient:
    def __init__(self, embed_playlist_id: str, query_hash: str):
        self.embed_playlist_id = embed_playlist_id
        self.query_hash = query_hash
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.token: Optional[str] = None

    def refresh_token(self) -> None:
        r = self.session.get(f"https://open.spotify.com/embed/playlist/{self.embed_playlist_id}", timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        m = TOKEN_RE.search(r.text)
        if not m:
            raise RuntimeError("No anonymous access token found on the Spotify embed page (page format changed?)")
        self.token = m.group(1)

    def playcount(self, track_id: str) -> Optional[int]:
        if not self.token:
            self.refresh_token()
        params = {
            "operationName": "getTrack",
            "variables": json.dumps({"uri": f"spotify:track:{track_id}"}),
            "extensions": json.dumps({"persistedQuery": {"version": 1, "sha256Hash": self.query_hash}}),
        }
        for attempt in range(4):
            r = self.session.get(
                PATHFINDER_URL,
                params=params,
                headers={"Authorization": f"Bearer {self.token}", "App-Platform": "WebPlayer"},
                timeout=REQUEST_TIMEOUT,
            )
            if r.status_code == 401:
                self.refresh_token()
                continue
            if r.status_code == 429 or r.status_code >= 500:
                wait = min(int(r.headers.get("Retry-After", "0") or 0) or 3 * (attempt + 1), 60)
                time.sleep(wait)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"getTrack {track_id} -> {r.status_code} {r.text[:200]}")
            return parse_playcount(r.json())
        raise RuntimeError(f"getTrack {track_id} kept failing")


def parse_playcount(payload: dict) -> Optional[int]:
    if payload.get("errors"):
        msg = "; ".join(str(e.get("message")) for e in payload["errors"])
        raise RuntimeError(f"getTrack GraphQL error: {msg[:200]}")
    union = ((payload.get("data") or {}).get("trackUnion")) or {}
    raw = union.get("playcount")
    if raw is None or str(raw).strip() == "":
        return None
    value = int(str(raw))
    return value if value >= 0 else None


# ---------------------------------------------------------------- main

def chunks(seq: List, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def in_filter(ids: List[str]) -> str:
    return "in.(" + ",".join(ids) + ")"


def run(args) -> int:
    run_date = args.run_date or datetime.now(timezone.utc).date().isoformat()
    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"), schema=SCHEMA)
    api_token = spotify_api_token(require_env("SPOTIFY_CLIENT_ID"), require_env("SPOTIFY_CLIENT_SECRET"))
    query_hash = (os.environ.get("PLAYCOUNT_QUERY_HASH") or "").strip() or DEFAULT_GET_TRACK_HASH

    playlists = pg.select("track_watch_playlists", "spotify_playlist_id,slug,removed_retention_days", "is_active=eq.true")
    if not playlists:
        print("No active track-watch playlists.")
        return 0

    total_attempted = total_failed = 0
    for pl in playlists:
        pid, slug = pl["spotify_playlist_id"], pl["slug"]
        print(f"== {slug} ({pid}) run_date={run_date}")
        try:
            meta, items = fetch_playlist(pid, api_token)
        except Exception as exc:  # noqa: BLE001
            print(f"[{slug}] playlist read failed: {exc}")
            if not args.dry_run:
                pg.patch("track_watch_playlists", {
                    "latest_checked_at": datetime.now(timezone.utc).isoformat(),
                    "last_check_status": "playlist_unavailable",
                    "last_check_message": str(exc)[:500],
                }, f"spotify_playlist_id=eq.{pid}")
            total_failed += 1
            continue

        current = normalize_items(items)
        existing = pg.select(
            "track_watch_memberships",
            "spotify_track_id,first_seen_date,removed_date",
            f"spotify_playlist_id=eq.{pid}&limit=10000",
        )
        upserts, removed_today = plan_memberships(pid, current, existing, run_date)
        existing_ids = {r["spotify_track_id"] for r in existing}
        added_today = [t["spotify_track_id"] for t in current if t["spotify_track_id"] not in existing_ids]
        print(f"[{slug}] {len(current)} tracks in playlist; +{len(added_today)} new, -{len(removed_today)} removed")

        collect_ids = tracks_to_collect(current, existing, removed_today, run_date, int(pl["removed_retention_days"]))

        if not args.dry_run:
            track_rows = [{k: t[k] for k in ("spotify_track_id", "isrc", "name", "artists", "album_name",
                                              "image_url", "release_date")} | {"updated_at": datetime.now(timezone.utc).isoformat()}
                          for t in current]
            for batch in chunks(track_rows, 200):
                pg.upsert("track_watch_tracks", batch, "spotify_track_id")
            for batch in chunks(upserts, 200):
                pg.upsert("track_watch_memberships", batch, "spotify_playlist_id,spotify_track_id")
            for batch in chunks(removed_today, 100):
                pg.patch("track_watch_memberships", {"removed_date": run_date},
                         f"spotify_playlist_id=eq.{pid}&spotify_track_id={in_filter(batch)}")

        client = PlaycountClient(pid, query_hash)
        snapshots, failures = [], []
        for i, tid in enumerate(collect_ids):
            try:
                count = client.playcount(tid)
                if count is None:
                    failures.append((tid, "no playcount"))
                else:
                    snapshots.append({"date": run_date, "spotify_track_id": tid, "playcount": count, "source": SOURCE})
            except Exception as exc:  # noqa: BLE001
                failures.append((tid, str(exc)))
                # A rotated query hash or changed embed page fails every call: stop early, loudly.
                if i >= 2 and len(failures) == i + 1:
                    print(f"[{slug}] first {i + 1} play-count calls all failed; aborting: {exc}")
                    break
            time.sleep(CALL_SPACING_S)
        for tid, why in failures[:10]:
            print(f"[{slug}] play count failed for {tid}: {why}")
        print(f"[{slug}] play counts: {len(snapshots)} ok, {len(failures)} failed of {len(collect_ids)}")

        if not args.dry_run:
            for batch in chunks(snapshots, 200):
                pg.upsert("track_watch_stream_snapshots", batch, "spotify_track_id,date")
            # Partial-column upserts only touch these columns on existing rows (all ids exist already).
            latest_rows = [{"spotify_track_id": s["spotify_track_id"], "latest_playcount": s["playcount"],
                            "latest_snapshot_date": run_date, "last_check_status": "ok"} for s in snapshots]
            for batch in chunks(latest_rows, 200):
                pg.upsert("track_watch_tracks", batch, "spotify_track_id")
            for batch in chunks([{"spotify_track_id": tid, "last_check_status": why[:200]} for tid, why in failures], 200):
                pg.upsert("track_watch_tracks", batch, "spotify_track_id")
            images = meta.get("images") or []
            failed_ratio = len(failures) / len(collect_ids) if collect_ids else 0
            pg.patch("track_watch_playlists", {
                "display_name": meta.get("name"),
                "owner_display_name": (meta.get("owner") or {}).get("display_name"),
                "image_url": images[0].get("url") if images else None,
                "track_count": len(current),
                "latest_checked_at": datetime.now(timezone.utc).isoformat(),
                "last_check_status": "ok" if not failures else ("partial" if failed_ratio <= MAX_FAILURE_RATIO else "failed"),
                "last_check_message": None if not failures else f"{len(failures)} of {len(collect_ids)} play counts failed",
            }, f"spotify_playlist_id=eq.{pid}")
        else:
            for s in snapshots[:5]:
                print(f"  sample {s['spotify_track_id']}: {s['playcount']}")

        total_attempted += len(collect_ids)
        total_failed += len(failures)

    if total_attempted and total_failed / total_attempted > MAX_FAILURE_RATIO:
        print(f"FAILED: {total_failed}/{total_attempted} play counts failed")
        return 1
    if total_failed and not total_attempted:
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="Fetch without writing to Supabase")
    parser.add_argument("--run-date", help="Snapshot date (default: today UTC)")
    sys.exit(run(parser.parse_args()))


if __name__ == "__main__":
    main()
