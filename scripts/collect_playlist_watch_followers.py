import argparse
import base64
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import requests


SPOTIFY_PLAYLIST_ID_RE = re.compile(r"^[A-Za-z0-9]{16,32}$")
SOURCE = "spotify_api"


def require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def parse_spotify_playlist_id(value: str) -> Optional[str]:
    raw = (value or "").strip()
    if not raw:
        return None

    uri_match = re.match(r"^spotify:playlist:([A-Za-z0-9]{16,32})$", raw)
    if uri_match:
        return uri_match.group(1)

    url_match = re.search(r"open\.spotify\.com/playlist/([A-Za-z0-9]{16,32})", raw)
    if url_match:
        return url_match.group(1)

    if SPOTIFY_PLAYLIST_ID_RE.match(raw):
        return raw
    return None


class SpotifyApiError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code


def playlist_status_for_error(error: Exception) -> str:
    if isinstance(error, SpotifyApiError):
        if error.status_code == 404:
            return "spotify_404"
        if error.status_code == 429:
            return "rate_limited"
    return "unavailable"


def build_snapshot_row(
    run_date: str,
    spotify_playlist_id: str,
    follower_count: int,
    source_run_id: Optional[int],
    source: str = SOURCE,
) -> Dict[str, Any]:
    return {
        "date": run_date,
        "spotify_playlist_id": spotify_playlist_id,
        "follower_count": follower_count,
        "source_run_id": source_run_id,
        "source": source,
    }


class Postgrest:
    def __init__(self, supabase_url: str, service_role_key: str):
        self.base = supabase_url.rstrip("/") + "/rest/v1"
        self.h = {
            "Authorization": f"Bearer {service_role_key}",
            "apikey": service_role_key,
            "Content-Type": "application/json",
            "Accept-Profile": "playlist_watch",
            "Content-Profile": "playlist_watch",
        }

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        response = requests.request(method, f"{self.base}/{path}", headers=self.h, timeout=180, **kwargs)
        if response.status_code >= 400:
            raise RuntimeError(f"PostgREST {method} {path} failed: {response.status_code} {response.text[:500]}")
        return response

    def select_active_playlists(self, limit: int, cursor: Optional[str] = None) -> List[dict]:
        filters = [
            "select=spotify_playlist_id,display_name,watch_status",
            "watch_status=eq.active",
            "order=spotify_playlist_id.asc",
            f"limit={int(limit)}",
        ]
        if cursor:
            filters.append(f"spotify_playlist_id=gt.{quote(cursor, safe='')}")
        response = self._request("GET", "playlists?" + "&".join(filters))
        return response.json()

    def create_run(self, run_date: str, source: str, commit_sha: Optional[str], logs_url: Optional[str]) -> int:
        headers = dict(self.h)
        headers["Prefer"] = "return=representation"
        response = requests.post(
            f"{self.base}/ingestion_runs",
            headers=headers,
            json={
                "run_date": run_date,
                "source": source,
                "status": "running",
                "commit_sha": commit_sha,
                "logs_url": logs_url,
            },
            timeout=180,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Create ingestion run failed: {response.status_code} {response.text[:500]}")
        return int(response.json()[0]["id"])

    def finish_run(
        self,
        run_id: int,
        status: str,
        attempted_count: int,
        success_count: int,
        failure_count: int,
        warnings_count: int,
        error_message: Optional[str] = None,
    ) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        patch = {
            "status": status,
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "attempted_count": attempted_count,
            "success_count": success_count,
            "failure_count": failure_count,
            "warnings_count": warnings_count,
            "error_message": error_message,
        }
        response = requests.patch(f"{self.base}/ingestion_runs?id=eq.{run_id}", headers=headers, json=patch, timeout=180)
        if response.status_code not in (200, 204):
            raise RuntimeError(f"Finish ingestion run failed: {response.status_code} {response.text[:500]}")

    def upsert_snapshot(self, row: dict) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "resolution=merge-duplicates,return=minimal"
        response = requests.post(
            f"{self.base}/follower_snapshots?on_conflict=date,spotify_playlist_id",
            headers=headers,
            json=row,
            timeout=180,
        )
        if response.status_code not in (200, 201, 204):
            raise RuntimeError(f"Upsert follower snapshot failed: {response.status_code} {response.text[:500]}")

    def update_playlist_success(self, playlist_id: str, meta: dict, follower_count: int, run_date: str) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        images = meta.get("images") or []
        owner = meta.get("owner") or {}
        external_urls = meta.get("external_urls") or {}
        patch = {
            "display_name": meta.get("name"),
            "owner_spotify_id": owner.get("id"),
            "owner_display_name": owner.get("display_name"),
            "spotify_url": external_urls.get("spotify"),
            "image_url": images[0].get("url") if images else None,
            "latest_follower_count": follower_count,
            "latest_snapshot_date": run_date,
            "latest_checked_at": datetime.now(timezone.utc).isoformat(),
            "last_check_status": "ok",
            "last_check_message": None,
        }
        response = requests.patch(
            f"{self.base}/playlists?spotify_playlist_id=eq.{quote(playlist_id, safe='')}",
            headers=headers,
            json=patch,
            timeout=180,
        )
        if response.status_code not in (200, 204):
            raise RuntimeError(f"Update playlist success failed: {response.status_code} {response.text[:500]}")

    def update_playlist_failure(self, playlist_id: str, status: str, message: str) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        patch = {
            "latest_checked_at": datetime.now(timezone.utc).isoformat(),
            "last_check_status": status,
            "last_check_message": message[:500],
        }
        response = requests.patch(
            f"{self.base}/playlists?spotify_playlist_id=eq.{quote(playlist_id, safe='')}",
            headers=headers,
            json=patch,
            timeout=180,
        )
        if response.status_code not in (200, 204):
            raise RuntimeError(f"Update playlist failure failed: {response.status_code} {response.text[:500]}")

    def insert_warning(self, run_id: int, run_date: str, playlist_id: str, code: str, message: str) -> None:
        headers = dict(self.h)
        headers["Prefer"] = "return=minimal"
        response = requests.post(
            f"{self.base}/ingestion_warnings",
            headers=headers,
            json={
                "run_id": run_id,
                "run_date": run_date,
                "spotify_playlist_id": playlist_id,
                "severity": "warn",
                "code": code,
                "message": message[:1000],
            },
            timeout=180,
        )
        if response.status_code not in (200, 201, 204):
            raise RuntimeError(f"Insert warning failed: {response.status_code} {response.text[:500]}")


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
            raise SpotifyApiError(response.status_code, f"Spotify token error: {response.text[:300]}")
        payload = response.json()
        self._token = payload["access_token"]
        self._expires_at = now + float(payload.get("expires_in", 3600))
        return self._token

    def get_playlist(self, playlist_id: str) -> dict:
        fields = "id,name,owner(id,display_name),images,external_urls,followers(total),items(total),tracks(total)"
        path = f"/playlists/{quote(playlist_id, safe='')}?fields={quote(fields, safe='(),')}"
        for attempt in range(5):
            response = requests.get(
                f"https://api.spotify.com/v1{path}",
                headers={"Authorization": f"Bearer {self.token()}"},
                timeout=60,
            )
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 5))
                if attempt == 4:
                    raise SpotifyApiError(429, "Spotify rate limit persisted after retries")
                print(f"Rate-limited, waiting {retry_after}s (attempt {attempt + 1}/5)...")
                time.sleep(retry_after)
                continue
            if response.status_code != 200:
                raise SpotifyApiError(response.status_code, response.text[:300])
            return response.json()
        raise SpotifyApiError(429, "Spotify rate limit persisted after retries")


def collect_followers(pg: Postgrest, sp: Spotify, run_date: str, limit: int, dry_run: bool = False) -> dict:
    rows = pg.select_active_playlists(limit=limit)
    commit_sha = os.environ.get("GITHUB_SHA")
    run_url = None
    if os.environ.get("GITHUB_SERVER_URL") and os.environ.get("GITHUB_REPOSITORY") and os.environ.get("GITHUB_RUN_ID"):
        run_url = f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{os.environ['GITHUB_RUN_ID']}"

    run_id = None if dry_run else pg.create_run(run_date, SOURCE, commit_sha, run_url)
    attempted = success = failure = warnings = 0
    fatal_error = None

    try:
        for row in rows:
            playlist_id = row.get("spotify_playlist_id")
            if not playlist_id:
                continue
            attempted += 1
            try:
                meta = sp.get_playlist(playlist_id)
                follower_count = ((meta.get("followers") or {}).get("total"))
                if follower_count is None:
                    raise SpotifyApiError(200, "Spotify response did not include followers.total")
                follower_count = int(follower_count)
                if not dry_run:
                    pg.upsert_snapshot(build_snapshot_row(run_date, playlist_id, follower_count, run_id))
                    pg.update_playlist_success(playlist_id, meta, follower_count, run_date)
                success += 1
                print(f"OK {playlist_id} followers={follower_count}")
            except Exception as exc:
                failure += 1
                warnings += 1
                check_status = playlist_status_for_error(exc)
                message = exc.args[0] if exc.args else str(exc)
                print(f"WARN {playlist_id} {check_status}: {message}")
                if not dry_run:
                    pg.update_playlist_failure(playlist_id, check_status, message)
                    pg.insert_warning(run_id, run_date, playlist_id, check_status, message)
    except Exception as exc:
        fatal_error = str(exc)
        raise
    finally:
        if run_id is not None:
            run_status = "failed" if fatal_error else "success"
            pg.finish_run(run_id, run_status, attempted, success, failure, warnings, fatal_error)

    return {
        "attempted": attempted,
        "success": success,
        "failure": failure,
        "warnings": warnings,
        "dry_run": dry_run,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-date", default=datetime.now(timezone.utc).date().isoformat())
    parser.add_argument("--limit", type=int, default=3000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pg = Postgrest(require_env("SUPABASE_URL"), require_env("SUPABASE_SERVICE_ROLE_KEY"))
    sp = Spotify(require_env("SPOTIFY_CLIENT_ID"), require_env("SPOTIFY_CLIENT_SECRET"))
    result = collect_followers(pg, sp, args.run_date, max(1, int(args.limit)), args.dry_run)
    print(f"Done. attempted={result['attempted']} success={result['success']} failure={result['failure']}")


if __name__ == "__main__":
    main()
