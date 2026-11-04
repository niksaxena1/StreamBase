"""Spotify play counts from the web player (the number shown in the Spotify app). No API key, no quota.

Uses the anonymous access token embedded in Spotify's public embed pages and the web player's
persisted `getTrack` GraphQL query. Unofficial: Spotify rotates the query hash occasionally; override
it with the PLAYCOUNT_QUERY_HASH env var (copy the current getTrack sha256Hash from open.spotify.com
network traffic). Verified 2026-11-04: 120/120 random own-catalog tracks matched the stored daily
cumulative exactly.

Used by scripts/collect_playlist_watch_track_streams.py and scripts/rapidapi_stale_fix.py.
"""

import json
import os
import re
import time
from typing import Optional

import requests

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v1/query"
DEFAULT_GET_TRACK_HASH = "ae85b52abb74d20a4c331d4143d4772c95f34757bfa8c625474b912b9055b5c0"
TOKEN_RE = re.compile(r'"accessToken":"([^"]+)"')
REQUEST_TIMEOUT = 20


def query_hash_from_env() -> str:
    return (os.environ.get("PLAYCOUNT_QUERY_HASH") or "").strip() or DEFAULT_GET_TRACK_HASH


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


class PlaycountClient:
    """embed_path: any public embed page, e.g. "track/<id>" or "playlist/<id>" (only used for the token)."""

    def __init__(self, embed_path: str, query_hash: Optional[str] = None):
        self.embed_path = embed_path
        self.query_hash = query_hash or query_hash_from_env()
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.token: Optional[str] = None

    def refresh_token(self) -> None:
        r = self.session.get(f"https://open.spotify.com/embed/{self.embed_path}", timeout=REQUEST_TIMEOUT)
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
