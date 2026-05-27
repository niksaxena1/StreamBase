import argparse
import base64
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def norm_isrc_for_lookup(value: str) -> str:
    raw = (value or "").strip().upper()
    return re.sub(r"[^A-Z0-9]", "", raw) if raw else ""


def candidate_filters(limit: int) -> List[str]:
    return [
        "order=spotify_artist_ids.nullsfirst,last_seen.desc",
        f"limit={int(limit)}",
    ]


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str, profile: str = "competitor"):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
            "Accept-Profile": profile,
            "Content-Profile": profile,
        }

    def select(self, table: str, select: str, filters: str) -> List[dict]:
        url = f"{self.base}/{table}?select={select}&{filters}"
        response = requests.get(url, headers=self.h, timeout=180)
        if response.status_code != 200:
            raise RuntimeError(f"Select {table} failed: {response.status_code} {response.text[:500]}")
        return response.json()

    def patch(self, table: str, patch_obj: dict, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        response = requests.patch(url, headers=headers, json=patch_obj, timeout=180)
        if response.status_code not in (200, 204):
            raise RuntimeError(f"Patch {table} failed: {response.status_code} {response.text[:500]}")

    def upsert(self, table: str, rows: List[dict], conflict: str):
        if not rows:
            return
        url = f"{self.base}/{table}?on_conflict={conflict}"
        headers = dict(self.h)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        response = requests.post(url, headers=headers, json=rows, timeout=180)
        if response.status_code not in (200, 201, 204):
            raise RuntimeError(f"Upsert {table} failed: {response.status_code} {response.text[:500]}")


class Spotify:
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: Optional[str] = None
        self._expires_at = 0.0

    def token(self) -> str:
        now = time.time()
        if self._token and self._expires_at > now + 30:
            return self._token

        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
        response = requests.post(
            "https://accounts.spotify.com/api/token",
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
            timeout=60,
        )
        if response.status_code != 200:
            raise RuntimeError(f"Spotify token error {response.status_code}: {response.text[:300]}")
        payload = response.json()
        self._token = payload["access_token"]
        self._expires_at = now + float(payload.get("expires_in", 3600))
        return self._token

    def get(self, path: str) -> Any:
        for attempt in range(5):
            response = requests.get(
                f"https://api.spotify.com/v1{path}",
                headers={"Authorization": f"Bearer {self.token()}"},
                timeout=60,
            )
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 5))
                print(f"  Rate-limited, waiting {retry_after}s (attempt {attempt + 1}/5)...")
                time.sleep(retry_after)
                continue
            if response.status_code != 200:
                raise RuntimeError(f"Spotify API error {response.status_code}: {response.text[:300]}")
            return response.json()
        raise RuntimeError("Spotify API still rate-limited after 5 retries")

    def find_track_by_isrc(self, isrc: str) -> Optional[Dict[str, Any]]:
        normalized = norm_isrc_for_lookup(isrc)
        if not normalized:
            return None

        item = None
        for query_isrc in (normalized, (isrc or "").strip()):
            if not query_isrc:
                continue
            query = requests.utils.quote(f"isrc:{query_isrc}")
            payload = self.get(f"/search?q={query}&type=track&limit=1")
            item = ((payload.get("tracks") or {}).get("items") or [None])[0]
            if item:
                break
        if not item:
            return None

        images = ((item.get("album") or {}).get("images") or [])
        artists = item.get("artists") or []
        return {
            "spotify_track_id": item.get("id"),
            "spotify_album_image_url": images[0]["url"] if images else None,
            "spotify_artist_ids": [artist.get("id") for artist in artists if artist.get("id")],
            "spotify_artist_names": [artist.get("name") for artist in artists if artist.get("name")],
        }

    def get_artists(self, artist_ids: List[str]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        seen = set()
        ids = []
        for artist_id in artist_ids:
            clean = (artist_id or "").strip()
            if clean and clean not in seen:
                seen.add(clean)
                ids.append(clean)

        for i in range(0, len(ids), 50):
            chunk = ids[i : i + 50]
            payload = self.get(f"/artists?ids={','.join(requests.utils.quote(x) for x in chunk)}")
            out.extend([artist for artist in (payload.get("artists") or []) if artist and artist.get("id")])
        return out


ENRICHMENT_FIELDS = {
    "spotify_track_id": None,
    "spotify_album_image_url": None,
    "spotify_artist_ids": None,
    "spotify_artist_names": None,
}


def cache_artist_images(pg_public: Postgrest, sp: Spotify, artist_ids: List[str]):
    artists = sp.get_artists(artist_ids)
    refreshed_at = datetime.now(timezone.utc).isoformat()
    rows = []
    for artist in artists:
        images = artist.get("images") or []
        rows.append(
            {
                "artist_id": artist.get("id"),
                "name": artist.get("name"),
                "image_url": images[0].get("url") if images else None,
                "external_url": (artist.get("external_urls") or {}).get("spotify"),
                "refreshed_at": refreshed_at,
            }
        )
    pg_public.upsert("spotify_artist_images", rows, "artist_id")
    if rows:
        print(f"Cached {len(rows)} Spotify artist image rows")


def enrich_single(pg: Postgrest, pg_public: Postgrest, sp: Spotify, isrc: str):
    isrc = isrc.strip()
    if not isrc:
        raise SystemExit("--isrc value cannot be empty")

    rows = pg.select("tracks", "isrc,name", f"isrc=eq.{isrc}&limit=1")
    if not rows:
        raise SystemExit(f"No competitor track found with ISRC {isrc}")

    pg.patch("tracks", dict(ENRICHMENT_FIELDS), f"isrc=eq.{isrc}")
    hit = sp.find_track_by_isrc(isrc)
    if not hit:
        print(f"No Spotify match found for competitor ISRC {isrc}.")
        return
    pg.patch("tracks", hit, f"isrc=eq.{isrc}")
    cache_artist_images(pg_public, sp, hit.get("spotify_artist_ids") or [])
    print(f"Re-enriched competitor track {isrc}")


def enrich_batch(pg: Postgrest, pg_public: Postgrest, sp: Spotify, limit: int):
    candidates = pg.select(
        "tracks",
        "isrc,name,spotify_artist_ids",
        "&".join(candidate_filters(limit)),
    )
    if not candidates:
        print("No competitor tracks to enrich.")
        return

    unenriched_count = sum(1 for candidate in candidates if not candidate.get("spotify_artist_ids"))
    print(
        f"Fetched {len(candidates)} competitor candidates "
        f"({unenriched_count} unenriched, {len(candidates) - unenriched_count} refresh)"
    )

    ok = miss = fail = 0
    artist_ids_to_cache = set()
    for row in candidates:
        isrc = (row.get("isrc") or "").strip()
        if not isrc:
            continue
        try:
            hit = sp.find_track_by_isrc(isrc)
            if not hit:
                miss += 1
                continue
            pg.patch("tracks", hit, f"isrc=eq.{isrc}")
            artist_ids_to_cache.update(hit.get("spotify_artist_ids") or [])
            ok += 1
            if ok % 20 == 0:
                print(f"Enriched {ok} competitor tracks...")
        except Exception as exc:
            fail += 1
            print(f"FAIL {isrc}: {exc}")

    cache_artist_images(pg_public, sp, sorted(artist_ids_to_cache))
    print(f"Done. ok={ok} miss={miss} fail={fail}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=5000, help="Max competitor tracks to enrich per run")
    parser.add_argument("--isrc", type=str, default=None, help="Re-enrich one competitor track by ISRC")
    args = parser.parse_args()

    supabase_url = require_env("SUPABASE_URL")
    service_role_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    pg = Postgrest(supabase_url, service_role_key, "competitor")
    pg_public = Postgrest(supabase_url, service_role_key, "public")
    sp = Spotify(require_env("SPOTIFY_CLIENT_ID"), require_env("SPOTIFY_CLIENT_SECRET"))

    if args.isrc:
        enrich_single(pg, pg_public, sp, args.isrc)
    else:
        enrich_batch(pg, pg_public, sp, args.limit)


if __name__ == "__main__":
    main()
