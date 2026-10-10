"""Best-effort Spotify change signals and atomic successful-sync checkpoints."""

import json
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import requests

if __package__:
    from .streambase_postgrest import Postgrest
else:
    from streambase_postgrest import Postgrest


def warn(message: str) -> None:
    print(f"[sync-state] Warning: {message}; syncing normally")


def resolve_dataset(config_path: str, dataset: Optional[str] = None) -> str:
    return dataset or ("competitor" if "competitor" in Path(config_path).name.lower() else "own")


@dataclass(frozen=True)
class PlaylistSnapshot:
    snapshot_id: str
    tracks_total: int


class SpotifySnapshots:
    def __init__(self, dataset: str):
        self.dataset = dataset
        self.playlist_ids = None
        self.token = None
        self.token_expires_at = 0.0

    def get(self, playlist_key: str) -> Optional[PlaylistSnapshot]:
        """A missing or unusable signal always means doing the regular SOT sync."""
        names = (
            "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
            "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET",
        )
        credentials = {name: (os.environ.get(name) or "").strip() for name in names}
        missing = [name for name, value in credentials.items() if not value]
        if missing:
            warn(f"{playlist_key}: missing {', '.join(missing)}")
            return None
        try:
            if self.playlist_ids is None:
                db = Postgrest(
                    credentials["SUPABASE_URL"], credentials["SUPABASE_SERVICE_ROLE_KEY"],
                    schema="competitor" if self.dataset == "competitor" else None,
                    timeout_s=15, max_retries=1,
                )
                rows = db.select_all(
                    "playlists", "playlist_key,spotify_playlist_id", "", order="playlist_key.asc",
                )
                self.playlist_ids = {row["playlist_key"]: row.get("spotify_playlist_id") for row in rows}
            playlist_id = self.playlist_ids.get(playlist_key)
            if not isinstance(playlist_id, str) or not playlist_id.strip():
                warn(f"{playlist_key}: no spotify_playlist_id")
                return None

            if not self.token or time.monotonic() >= self.token_expires_at:
                response = requests.post(
                    "https://accounts.spotify.com/api/token",
                    data={"grant_type": "client_credentials"},
                    auth=(credentials["SPOTIFY_CLIENT_ID"], credentials["SPOTIFY_CLIENT_SECRET"]),
                    timeout=15,
                )
                response.raise_for_status()
                payload = response.json()
                token = payload["access_token"]
                if not isinstance(token, str) or not token:
                    raise ValueError("invalid access token")
                expires_in = float(payload["expires_in"])
                self.token = token
                self.token_expires_at = time.monotonic() + max(0, expires_in - 30)

            response = requests.get(
                f"https://api.spotify.com/v1/playlists/{quote(playlist_id.strip(), safe='')}",
                params={"fields": "snapshot_id,tracks.total"},
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=15,
            )
            # Reacquire a token for the next playlist after an unexpected expiry.
            if response.status_code == 401:
                self.token = None
            response.raise_for_status()
            payload = response.json()
            snapshot_id = payload["snapshot_id"]
            tracks_total = payload["tracks"]["total"]
            if not isinstance(snapshot_id, str) or not snapshot_id:
                raise ValueError("invalid snapshot_id")
            if type(tracks_total) is not int or tracks_total < 0:
                raise ValueError("invalid tracks.total")
            return PlaylistSnapshot(snapshot_id, tracks_total)
        except Exception as exc:
            # Do not echo HTTP exception text: it can contain credentials/headers.
            warn(f"{playlist_key}: snapshot lookup failed ({type(exc).__name__})")
            return None


class SyncState:
    def __init__(self, path: str, *, dry_run: bool = False):
        self.path = Path(path)
        self.dry_run = dry_run
        self.entries = {}
        try:
            entries = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(entries, dict):
                raise ValueError("state must be an object")
            self.entries = entries
        except FileNotFoundError:
            pass
        except Exception as exc:
            warn(f"cannot read state ({type(exc).__name__})")

    def should_skip(self, task, snapshot: Optional[PlaylistSnapshot], *, full: bool = False) -> bool:
        entry = self.entries.get(task.playlist_key)
        return bool(
            not full and snapshot is not None and isinstance(entry, dict)
            and entry.get("snapshot_id") == snapshot.snapshot_id
            and entry.get("dashboard_name") == task.dashboard_name
            and entry.get("sot_playlist_id") == task.sot_playlist_id
        )

    def invalidate(self, playlist_key: str) -> None:
        """Invalidate before browser work, so interruption cannot keep stale success."""
        if not self.dry_run:
            self.entries.pop(playlist_key, None)
            self.persist()

    def complete(self, task, snapshot: Optional[PlaylistSnapshot], *, successful: bool, track_count: int) -> None:
        if self.dry_run:
            return
        self.entries.pop(task.playlist_key, None)
        if successful and snapshot is not None and track_count == snapshot.tracks_total:
            self.entries[task.playlist_key] = {
                "snapshot_id": snapshot.snapshot_id,
                "tracks_total": snapshot.tracks_total,
                "dashboard_name": task.dashboard_name,
                "sot_playlist_id": task.sot_playlist_id,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
        elif successful and snapshot is not None:
            warn(f"{task.playlist_key}: SOT count {track_count} differs from Spotify count {snapshot.tracks_total}")
        self.persist()

    def persist(self) -> None:
        if self.dry_run:
            return
        temporary_path = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.path.parent,
                prefix=self.path.name + ".", suffix=".tmp", delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                json.dump(self.entries, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.path)
        except Exception as exc:
            warn(f"cannot write state ({type(exc).__name__})")
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass
