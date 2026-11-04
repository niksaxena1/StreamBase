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
  5. For "upload": the same for Beatport chart tracks not in the playlist (upload candidates), mapped
     ISRC -> Spotify id via Spotify search (playlist_watch.track_watch_isrc_map; misses re-checked weekly).

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
from spotify_web_playcount import PlaycountClient, parse_playcount, query_hash_from_env  # noqa: E402,F401

SCHEMA = "playlist_watch"
SOURCE = "spotify_web_player"
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


# ---------------------------------------------------------------- main

NOT_FOUND_RECHECK_DAYS = 7


def spotify_track_for_isrc(isrc: str, token: str) -> Optional[dict]:
    data = spotify_get("https://api.spotify.com/v1/search", token, {"q": f"isrc:{isrc}", "type": "track", "limit": 1})
    items = ((data.get("tracks") or {}).get("items")) or []
    return items[0] if items else None


_PAREN_RE = re.compile(r"[\(\[][^\)\]]*[\)\]]")
_FEAT_RE = re.compile(r"\s+(feat\.?|ft\.?|featuring|with)\s+.*$", re.I)


def norm_title(value: str) -> str:
    """Title without bracketed parts, feat. credits, ' - Extended Mix' suffixes and punctuation."""
    t = _PAREN_RE.sub(" ", value or "")
    t = t.split(" - ")[0]
    t = _FEAT_RE.sub("", t)
    return re.sub(r"[^0-9a-z]+", " ", t.lower()).strip()


def norm_artist(value: str) -> str:
    return re.sub(r"[^0-9a-z]+", " ", (value or "").lower()).strip()


def is_remix_mix(mix_name: Optional[str]) -> bool:
    m = (mix_name or "").lower()
    return bool(m) and not re.search(r"extended|original|radio|club mix|^mix$", m)


def pick_name_match(candidates: List[dict], name: str, mix_name: Optional[str], artists: str, isrc: str) -> Optional[dict]:
    """Best Spotify search hit for the same song: same base title, a shared artist, same remix.

    Beatport often lists the extended mix under its own ISRC, so this finds the Spotify release of the
    same song. A remix must carry the remix name; an original/extended mix must not be a remix. Same
    ISRC registrant+year (first 7 chars) wins ties.
    """
    want_title = norm_title(name)
    want_artists = {norm_artist(a) for a in (artists or "").split(",") if norm_artist(a)}
    remix_words = set(norm_artist(mix_name).split()) if is_remix_mix(mix_name) else set()
    best, best_score = None, -1
    for c in candidates:
        cname = (c or {}).get("name") or ""
        if not c or not c.get("id") or norm_title(cname) != want_title:
            continue
        have = {norm_artist(a.get("name", "")) for a in c.get("artists") or []}
        if not (want_artists & have):
            continue
        cwords = set(norm_artist(cname).split())
        if remix_words and not remix_words <= cwords:
            continue
        if not remix_words and "remix" in cwords:
            continue
        cand_isrc = str((c.get("external_ids") or {}).get("isrc") or "").upper()
        score = 1 if isrc and cand_isrc[:7] == isrc[:7] else 0
        if score > best_score:
            best, best_score = c, score
    return best


def spotify_track_by_name(name: str, mix_name: Optional[str], artists: str, isrc: str, token: str) -> Optional[dict]:
    first_artist = (artists or "").split(",")[0].strip()
    query = f"{name} {mix_name} {first_artist}" if is_remix_mix(mix_name) else f"{name} {first_artist}"
    data = spotify_get("https://api.spotify.com/v1/search", token, {"q": query, "type": "track", "limit": 10})
    items = ((data.get("tracks") or {}).get("items")) or []
    return pick_name_match(items, name, mix_name, artists, isrc)


def track_row_from_api(track: dict, isrc: str) -> dict:
    album = track.get("album") or {}
    images = sorted((i for i in album.get("images") or [] if i.get("url")), key=lambda i: i.get("width") or 0)
    image = next((i["url"] for i in images if (i.get("width") or 0) >= 64), images[-1]["url"] if images else None)
    return {
        "spotify_track_id": track["id"],
        "isrc": isrc,
        "name": track.get("name"),
        "artists": ", ".join(a.get("name") for a in track.get("artists") or [] if a.get("name")),
        "album_name": album.get("name"),
        "image_url": image,
        "release_date": album.get("release_date"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def collect_chart_candidates(pg: Postgrest, api_token: str, query_hash: str, slug: str, run_date: str,
                             dry_run: bool) -> Tuple[int, int]:
    """Play counts for Beatport chart tracks not in the playlist (upload candidates). Returns (attempted, failed)."""
    rows = pg.rpc("track_watch_chart_candidates", {"p_slug": slug}) or []
    isrcs = sorted({str(r["isrc"]).upper() for r in rows if r.get("isrc")})
    if not isrcs:
        print("[charts] no chart candidates")
        return 0, 0
    known = {}
    for batch in chunks(isrcs, 100):
        for m in pg.select("track_watch_isrc_map", "isrc,spotify_track_id,status,checked_at", f"isrc={in_filter(batch)}"):
            known[m["isrc"]] = m
    recheck_before = (datetime.now(timezone.utc) - timedelta(days=NOT_FOUND_RECHECK_DAYS)).isoformat()
    by_isrc = {str(r["isrc"]).upper(): r for r in rows if r.get("isrc")}
    to_map = [i for i in isrcs if i not in known
              or (not known[i].get("spotify_track_id") and str(known[i].get("checked_at")) < recheck_before)]
    map_rows, track_rows = [], []
    for isrc in to_map:
        try:
            track, status = spotify_track_for_isrc(isrc, api_token), "ok"
            if not track:
                r = by_isrc[isrc]
                track, status = spotify_track_by_name(r.get("name") or "", r.get("mix_name"), r.get("artists") or "", isrc, api_token), "name_match"
        except Exception as exc:  # noqa: BLE001
            print(f"[charts] ISRC search failed for {isrc}: {exc}")
            map_rows.append({"isrc": isrc, "spotify_track_id": None, "status": "error",
                             "checked_at": datetime.now(timezone.utc).isoformat()})
            continue
        now = datetime.now(timezone.utc).isoformat()
        if track and track.get("id") and TRACK_ID_RE.match(track["id"]):
            map_rows.append({"isrc": isrc, "spotify_track_id": track["id"], "status": status, "checked_at": now})
            track_rows.append(track_row_from_api(track, isrc))
            known[isrc] = {"spotify_track_id": track["id"]}
        else:
            map_rows.append({"isrc": isrc, "spotify_track_id": None, "status": "not_found", "checked_at": now})
    if not dry_run:
        for batch in chunks(track_rows, 200):
            pg.upsert("track_watch_tracks", batch, "spotify_track_id")
        for batch in chunks(map_rows, 200):
            pg.upsert("track_watch_isrc_map", batch, "isrc")

    ids = sorted({known[i]["spotify_track_id"] for i in isrcs if (known.get(i) or {}).get("spotify_track_id")})
    done_today = {r["spotify_track_id"] for r in rows if r.get("spotify_track_id") and r.get("latest_date") == run_date}
    ids = [i for i in ids if i not in done_today]
    print(f"[charts] {len(isrcs)} chart candidates; {len(to_map)} ISRC lookups; {len(ids)} play counts to fetch")
    client = PlaycountClient(f"track/{ids[0]}" if ids else "playlist/39VN40Aa1bTQEtkuo0HOjD", query_hash)
    snapshots, failed = [], 0
    for tid in ids:
        try:
            count = client.playcount(tid)
            if count is None:
                failed += 1
            else:
                snapshots.append({"date": run_date, "spotify_track_id": tid, "playcount": count, "source": SOURCE})
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[charts] play count failed for {tid}: {exc}")
        time.sleep(CALL_SPACING_S)
    print(f"[charts] play counts: {len(snapshots)} ok, {failed} failed")
    if not dry_run:
        for batch in chunks(snapshots, 200):
            pg.upsert("track_watch_stream_snapshots", batch, "spotify_track_id,date")
        latest_rows = [{"spotify_track_id": s["spotify_track_id"], "latest_playcount": s["playcount"],
                        "latest_snapshot_date": run_date, "last_check_status": "ok"} for s in snapshots]
        for batch in chunks(latest_rows, 200):
            pg.upsert("track_watch_tracks", batch, "spotify_track_id")
    elif snapshots:
        print(f"  sample chart {snapshots[0]['spotify_track_id']}: {snapshots[0]['playcount']}")
    return len(ids), failed


def chunks(seq: List, n: int):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def in_filter(ids: List[str]) -> str:
    return "in.(" + ",".join(ids) + ")"


def run(args) -> int:
    run_date = args.run_date or datetime.now(timezone.utc).date().isoformat()
    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"), schema=SCHEMA)
    api_token = spotify_api_token(require_env("SPOTIFY_CLIENT_ID"), require_env("SPOTIFY_CLIENT_SECRET"))
    query_hash = query_hash_from_env()

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

        client = PlaycountClient(f"playlist/{pid}", query_hash)
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

        if pl["slug"] == "upload" and not args.skip_charts:
            try:  # the playlist data above is already saved; a chart-side error is reported, not fatal
                attempted, failed = collect_chart_candidates(pg, api_token, query_hash, slug, run_date, args.dry_run)
                total_attempted += attempted
                total_failed += failed
            except Exception as exc:  # noqa: BLE001
                print(f"::warning::[charts] upload candidates step failed: {exc}")

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
    parser.add_argument("--skip-charts", action="store_true", help="Skip Beatport chart candidates")
    sys.exit(run(parser.parse_args()))


if __name__ == "__main__":
    main()
