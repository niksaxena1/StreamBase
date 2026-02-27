import argparse
import base64
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests


def require_env(name: str) -> str:
    v = (os.environ.get(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {name}")
    return v


def norm_isrc_for_lookup(s: str) -> str:
    """
    Normalize an ISRC into Spotify's expected canonical form:
    - uppercase
    - remove hyphens/spaces/any non-alphanumeric characters
    Example: "GB-SMU-30-65473" -> "GBSMU3065473"
    """
    raw = (s or "").strip().upper()
    if not raw:
        return ""
    return re.sub(r"[^A-Z0-9]", "", raw)


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
        }

    def select(self, table: str, select: str, filters: str) -> List[dict]:
        url = f"{self.base}/{table}?select={select}&{filters}"
        r = requests.get(url, headers=self.h, timeout=180)
        if r.status_code != 200:
            raise RuntimeError(f"Select {table} failed: {r.status_code} {r.text[:500]}")
        return r.json()

    def patch(self, table: str, patch_obj: dict, filters: str):
        url = f"{self.base}/{table}?{filters}"
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        r = requests.patch(url, headers=headers, json=patch_obj, timeout=180)
        if r.status_code not in (200, 204):
            raise RuntimeError(f"Patch {table} failed: {r.status_code} {r.text[:500]}")


class Spotify:
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: Optional[str] = None
        self._expires_at: float = 0.0

    def token(self) -> str:
        now = time.time()
        if self._token and self._expires_at > now + 30:
            return self._token

        auth = base64.b64encode(f"{self.client_id}:{self.client_secret}".encode("utf-8")).decode("utf-8")
        res = requests.post(
            "https://accounts.spotify.com/api/token",
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
            timeout=60,
        )
        if res.status_code != 200:
            raise RuntimeError(f"Spotify token error {res.status_code}: {res.text[:300]}")
        j = res.json()
        self._token = j["access_token"]
        self._expires_at = now + float(j.get("expires_in", 3600))
        return self._token

    def get(self, path: str) -> Any:
        for attempt in range(5):
            res = requests.get(
                f"https://api.spotify.com/v1{path}",
                headers={"Authorization": f"Bearer {self.token()}"},
                timeout=60,
            )
            if res.status_code == 429:
                retry_after = int(res.headers.get("Retry-After", 5))
                print(f"  Rate-limited, waiting {retry_after}s (attempt {attempt + 1}/5)...")
                time.sleep(retry_after)
                continue
            if res.status_code != 200:
                raise RuntimeError(f"Spotify API error {res.status_code}: {res.text[:300]}")
            return res.json()
        raise RuntimeError(f"Spotify API still rate-limited after 5 retries")

    def find_track_by_isrc(self, isrc: str) -> Optional[Dict[str, Any]]:
        # Spotify search expects canonical 12-char alphanumeric ISRCs.
        # SpotOnTrack sometimes exports hyphenated ISRCs (e.g. "GB-SMU-30-65473").
        isrc_norm = norm_isrc_for_lookup(isrc)
        if not isrc_norm:
            return None

        # Try normalized first; if that misses, fall back to raw for safety.
        for query_isrc in (isrc_norm, (isrc or "").strip()):
            if not query_isrc:
                continue
            q = requests.utils.quote(f"isrc:{query_isrc}")
            resp = self.get(f"/search?q={q}&type=track&limit=1")
            item = ((resp.get("tracks") or {}).get("items") or [None])[0]
            if item:
                break
        else:
            item = None
        if not item:
            return None
        images = ((item.get("album") or {}).get("images") or [])
        best_img = images[0]["url"] if images else None
        artists = item.get("artists") or []
        return {
            "spotify_track_id": item.get("id"),
            "spotify_album_id": (item.get("album") or {}).get("id"),
            "spotify_album_name": (item.get("album") or {}).get("name"),
            "spotify_album_image_url": best_img,
            "spotify_artist_ids": [a.get("id") for a in artists if a.get("id")],
            "spotify_artist_names": [a.get("name") for a in artists if a.get("name")],
            "spotify_last_fetched_at": datetime.now(timezone.utc).isoformat(),
        }


ENRICHMENT_FIELDS = {
    "spotify_track_id": None,
    "spotify_album_id": None,
    "spotify_album_name": None,
    "spotify_album_image_url": None,
    "spotify_artist_ids": None,
    "spotify_artist_names": None,
    "spotify_last_fetched_at": None,
}


def enrich_single(pg: Postgrest, sp: Spotify, isrc: str):
    """Clear enrichment for a single ISRC and re-fetch from Spotify."""
    isrc = isrc.strip()
    if not isrc:
        raise SystemExit("--isrc value cannot be empty")

    rows = pg.select("tracks", "isrc,name", f"isrc=eq.{isrc}&limit=1")
    if not rows:
        raise SystemExit(f"No track found in DB with ISRC {isrc}")

    name = rows[0].get("name") or isrc
    print(f"Target: {name} ({isrc})")

    print("Clearing stale enrichment fields...")
    pg.patch("tracks", dict(ENRICHMENT_FIELDS), f"isrc=eq.{isrc}")

    print("Searching Spotify...")
    hit = sp.find_track_by_isrc(isrc)
    if not hit:
        print(f"No Spotify match found for ISRC {isrc}. Enrichment fields left cleared.")
        return

    pg.patch("tracks", hit, f"isrc=eq.{isrc}")
    sp_name = hit.get("spotify_album_name") or "?"
    sp_artists = ", ".join(hit.get("spotify_artist_names") or []) or "?"
    print(f"Re-enriched: {sp_artists} – {sp_name} (track {hit.get('spotify_track_id')})")


def enrich_batch(pg: Postgrest, sp: Spotify, limit: int):
    """Bulk-enrich tracks, prioritising unenriched rows."""
    filters = [
        "order=spotify_artist_ids.nullsfirst,last_seen.desc",
        f"limit={int(limit)}",
    ]

    candidates = pg.select("tracks", "isrc,name,spotify_artist_ids,spotify_last_fetched_at", "&".join(filters))
    if not candidates:
        print("No tracks to enrich.")
        return

    unenriched_count = sum(1 for c in candidates if not c.get("spotify_artist_ids"))
    print(f"Fetched {len(candidates)} candidates ({unenriched_count} unenriched, {len(candidates) - unenriched_count} refresh)")

    ok = 0
    miss = 0
    fail = 0

    for row in candidates:
        isrc_db = (row.get("isrc") or "").strip()
        if not isrc_db:
            continue
        try:
            hit = sp.find_track_by_isrc(isrc_db)
            if not hit:
                miss += 1
                continue
            pg.patch("tracks", hit, f"isrc=eq.{isrc_db}")
            ok += 1
            if ok % 20 == 0:
                print(f"Enriched {ok} tracks...")
        except Exception as e:
            fail += 1
            print(f"FAIL {isrc_db}: {e}")

    print(f"Done. ok={ok} miss={miss} fail={fail}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5000, help="Max tracks to enrich per run")
    ap.add_argument(
        "--only-missing",
        action="store_true",
        help="Only enrich tracks missing spotify_artist_ids (default: true)",
    )
    ap.add_argument(
        "--isrc",
        type=str,
        default=None,
        help="Re-enrich a single track by ISRC (clears stale data first)",
    )
    args = ap.parse_args()

    supabase_url = require_env("SUPABASE_URL")
    service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    spotify_id = require_env("SPOTIFY_CLIENT_ID")
    spotify_secret = require_env("SPOTIFY_CLIENT_SECRET")

    pg = Postgrest(supabase_url=supabase_url, service_role_key=service_key)
    sp = Spotify(client_id=spotify_id, client_secret=spotify_secret)

    if args.isrc:
        enrich_single(pg, sp, args.isrc)
    else:
        enrich_batch(pg, sp, args.limit)


if __name__ == "__main__":
    main()

