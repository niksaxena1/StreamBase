import argparse
import base64
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def has_missing_image_filter(force: bool) -> Optional[str]:
    return None if force else "spotify_playlist_image_url=is.null"


def playlist_key_filter(playlist_keys: List[str]) -> Optional[str]:
    clean = [key.strip() for key in playlist_keys if key.strip()]
    if not clean:
        return None
    quoted = ",".join(f'"{key}"' for key in clean)
    return f"playlist_key=in.({quoted})"


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
            "Accept-Profile": "competitor",
            "Content-Profile": "competitor",
        }

    def select_playlists(self, limit: int, cursor: Optional[str], force: bool, playlist_keys: List[str]) -> List[dict]:
        filters = [
            "select=playlist_key,display_name,spotify_playlist_id,spotify_playlist_image_url",
            "is_active=eq.true",
            "spotify_playlist_id=not.is.null",
            "order=playlist_key.asc",
            f"limit={int(limit)}",
        ]
        if cursor:
            filters.append(f"playlist_key=gt.{quote(cursor, safe='')}")
        missing_filter = has_missing_image_filter(force)
        if missing_filter:
            filters.append(missing_filter)
        key_filter = playlist_key_filter(playlist_keys)
        if key_filter:
            filters.append(key_filter)

        response = requests.get(f"{self.base}/playlists?{'&'.join(filters)}", headers=self.h, timeout=180)
        if response.status_code != 200:
            raise RuntimeError(f"Select competitor.playlists failed: {response.status_code} {response.text[:500]}")
        return response.json()

    def update_playlist(self, playlist_key: str, meta: Dict[str, Any]) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        patch = {
            "spotify_playlist_image_url": meta.get("image_url"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        response = requests.patch(
            f"{self.base}/playlists?playlist_key=eq.{quote(playlist_key, safe='')}",
            headers=headers,
            json=patch,
            timeout=180,
        )
        if response.status_code not in (200, 204):
            raise RuntimeError(f"Update competitor.playlists failed: {response.status_code} {response.text[:500]}")


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

    def get_playlist(self, playlist_id: str) -> Dict[str, Any]:
        fields = "id,name,images,external_urls"
        path = f"/playlists/{quote(playlist_id, safe='')}?fields={quote(fields, safe='(),')}"
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
            payload = response.json()
            images = payload.get("images") or []
            return {
                "id": payload.get("id"),
                "name": payload.get("name"),
                "image_url": images[0].get("url") if images else None,
                "external_url": (payload.get("external_urls") or {}).get("spotify"),
            }
        raise RuntimeError("Spotify API still rate-limited after 5 retries")


def refresh_batch(pg: Postgrest, sp: Spotify, limit: int, force: bool, playlist_keys: List[str]) -> None:
    cursor = None
    attempted = updated = failed = 0

    while True:
        rows = pg.select_playlists(limit=limit, cursor=cursor, force=force, playlist_keys=playlist_keys)
        if not rows:
            break

        for row in rows:
            playlist_key = str(row.get("playlist_key") or "").strip()
            spotify_playlist_id = str(row.get("spotify_playlist_id") or "").strip()
            if not playlist_key or not spotify_playlist_id:
                continue
            attempted += 1
            try:
                meta = sp.get_playlist(spotify_playlist_id)
                pg.update_playlist(playlist_key, meta)
                updated += 1
                print(f"OK {playlist_key}: {meta.get('name')} ({'image' if meta.get('image_url') else 'no image'})")
            except Exception as exc:
                failed += 1
                print(f"FAIL {playlist_key}: {exc}")

        if len(rows) < limit or playlist_keys:
            break
        cursor = rows[-1].get("playlist_key")

    print(f"Done. attempted={attempted} updated={updated} failed={failed}")
    if failed:
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=50, help="Batch size for competitor playlists")
    parser.add_argument("--force", action="store_true", help="Refresh existing thumbnail URLs too")
    parser.add_argument("--playlist-key", action="append", default=[], help="Restrict to one playlist key; repeatable")
    args = parser.parse_args()

    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    sp = Spotify(require_env("SPOTIFY_CLIENT_ID"), require_env("SPOTIFY_CLIENT_SECRET"))
    refresh_batch(pg, sp, args.limit, args.force, args.playlist_key)


if __name__ == "__main__":
    main()
