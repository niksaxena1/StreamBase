import argparse
import base64
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests


def require_env(name: str) -> str:
    v = (os.environ.get(name) or "").strip()
    if not v:
        raise SystemExit(f"Missing env var: {name}")
    return v


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
        res = requests.get(
            f"https://api.spotify.com/v1{path}",
            headers={"Authorization": f"Bearer {self.token()}"},
            timeout=60,
        )
        if res.status_code != 200:
            raise RuntimeError(f"Spotify API error {res.status_code}: {res.text[:300]}")
        return res.json()

    def find_track_by_isrc(self, isrc: str) -> Optional[Dict[str, Any]]:
        q = requests.utils.quote(f"isrc:{isrc}")
        resp = self.get(f"/search?q={q}&type=track&limit=1")
        item = ((resp.get("tracks") or {}).get("items") or [None])[0]
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=200, help="Max tracks to enrich per run")
    ap.add_argument(
        "--only-missing",
        action="store_true",
        help="Only enrich tracks missing spotify_artist_ids (default: true)",
    )
    args = ap.parse_args()

    supabase_url = require_env("SUPABASE_URL")
    service_key = require_env("SUPABASE_SERVICE_ROLE_KEY")
    spotify_id = require_env("SPOTIFY_CLIENT_ID")
    spotify_secret = require_env("SPOTIFY_CLIENT_SECRET")

    pg = Postgrest(supabase_url=supabase_url, service_role_key=service_key)
    sp = Spotify(client_id=spotify_id, client_secret=spotify_secret)

    # Fetch candidate tracks.
    # Note: PostgREST URL encoding is picky; keep filters simple.
    # Updated to enrich all tracks daily to catch artist name changes.
    filters = [
        "order=last_seen.desc",
        f"limit={int(args.limit)}",
    ]

    candidates = pg.select("tracks", "isrc,name,spotify_artist_ids,spotify_last_fetched_at", "&".join(filters))
    if not candidates:
        print("No tracks to enrich.")
        return

    ok = 0
    miss = 0
    fail = 0

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
            ok += 1
            if ok % 20 == 0:
                print(f"Enriched {ok} tracks...")
        except Exception as e:
            fail += 1
            print(f"FAIL {isrc}: {e}")

    print(f"Done. ok={ok} miss={miss} fail={fail}")


if __name__ == "__main__":
    main()

