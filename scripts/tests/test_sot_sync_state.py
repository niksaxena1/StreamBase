import json
from unittest.mock import Mock

import pytest
import requests

from scripts.sot_sync_dashboards import SyncTask
from scripts.sot_sync_state import PlaylistSnapshot, SpotifySnapshots, SyncState, resolve_dataset


@pytest.fixture
def task():
    return SyncTask("label", "Label", "https://example.com/dashboard", "Dashboard", "123")


@pytest.fixture
def credentials(monkeypatch):
    for name, value in {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-key",
        "SPOTIFY_CLIENT_ID": "client-id",
        "SPOTIFY_CLIENT_SECRET": "client-secret",
    }.items():
        monkeypatch.setenv(name, value)


def response(payload, status=200):
    result = Mock(status_code=status, text="HTTP error")
    result.json.return_value = payload
    if status >= 400:
        result.raise_for_status.side_effect = requests.HTTPError("HTTP error")
    return result


def mock_http(monkeypatch, rows=None):
    db = Mock(return_value=response(rows if rows is not None else [
        {"playlist_key": "label", "spotify_playlist_id": "spotify123"},
    ]))
    token = Mock(return_value=response({"access_token": "token", "expires_in": 3600}))
    playlist = Mock(return_value=response({"snapshot_id": "snapshot", "tracks": {"total": 2}}))
    monkeypatch.setattr("scripts.streambase_postgrest.requests.request", db)
    monkeypatch.setattr("scripts.sot_sync_state.requests.post", token)
    monkeypatch.setattr("scripts.sot_sync_state.requests.get", playlist)
    return db, token, playlist


@pytest.mark.parametrize("dataset", ["own", "competitor"])
def test_snapshot_http_and_schema(monkeypatch, credentials, dataset):
    db, token, playlist = mock_http(monkeypatch)
    source = SpotifySnapshots(dataset)
    assert source.get("label") == PlaylistSnapshot("snapshot", 2)
    assert source.get("label") == PlaylistSnapshot("snapshot", 2)
    db.assert_called_once()
    args, kwargs = db.call_args
    assert args[0] == "GET"
    assert args[1].startswith("https://example.supabase.co/rest/v1/playlists?select=playlist_key,spotify_playlist_id&")
    assert kwargs["headers"]["apikey"] == "service-key"
    assert kwargs["headers"].get("Accept-Profile") == ("competitor" if dataset == "competitor" else None)
    token.assert_called_once_with(
        "https://accounts.spotify.com/api/token", data={"grant_type": "client_credentials"},
        auth=("client-id", "client-secret"), timeout=15,
    )
    playlist.assert_called_with(
        "https://api.spotify.com/v1/playlists/spotify123",
        params={"fields": "snapshot_id,tracks.total"},
        headers={"Authorization": "Bearer token"}, timeout=15,
    )


@pytest.mark.parametrize("name", [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET",
])
def test_missing_credentials_fail_open(monkeypatch, credentials, capsys, name):
    db, token, playlist = mock_http(monkeypatch)
    monkeypatch.delenv(name)
    assert SpotifySnapshots("own").get("label") is None
    assert name in capsys.readouterr().out
    db.assert_not_called()
    token.assert_not_called()
    playlist.assert_not_called()


@pytest.mark.parametrize("stage", ["supabase", "token", "spotify"])
@pytest.mark.parametrize("failure", ["http", "timeout", "json"])
def test_http_failures_fail_open(monkeypatch, credentials, capsys, stage, failure):
    calls = mock_http(monkeypatch)
    selected = calls[("supabase", "token", "spotify").index(stage)]
    if failure == "http":
        selected.return_value = response({}, status=403)
    elif failure == "timeout":
        selected.side_effect = requests.Timeout("timeout")
    else:
        selected.return_value.json.side_effect = ValueError("invalid JSON")
    assert SpotifySnapshots("competitor").get("label") is None
    assert "Warning" in capsys.readouterr().out


@pytest.mark.parametrize("rows", [[], [{"playlist_key": "label", "spotify_playlist_id": None}],
                                 [{"playlist_key": "label", "spotify_playlist_id": " "}]])
def test_missing_playlist_id_fails_open(monkeypatch, credentials, capsys, rows):
    _, token, playlist = mock_http(monkeypatch, rows)
    assert SpotifySnapshots("own").get("label") is None
    assert "no spotify_playlist_id" in capsys.readouterr().out
    token.assert_not_called()
    playlist.assert_not_called()


@pytest.mark.parametrize("payload", [
    {}, {"snapshot_id": "", "tracks": {"total": 2}},
    {"snapshot_id": "id", "tracks": {"total": -1}},
    {"snapshot_id": "id", "tracks": {"total": "2"}},
    {"snapshot_id": "id", "tracks": {"total": True}},
])
def test_invalid_spotify_signal_fails_open(monkeypatch, credentials, payload):
    _, _, playlist = mock_http(monkeypatch)
    playlist.return_value = response(payload)
    assert SpotifySnapshots("own").get("label") is None


def test_one_playlist_failure_does_not_block_others(monkeypatch, credentials):
    _, token, playlist = mock_http(monkeypatch, [
        {"playlist_key": "label", "spotify_playlist_id": "first"},
        {"playlist_key": "second", "spotify_playlist_id": "second"},
    ])
    playlist.side_effect = [response({}, status=404), response({"snapshot_id": "ok", "tracks": {"total": 0}})]
    source = SpotifySnapshots("own")
    assert source.get("label") is None
    assert source.get("second") == PlaylistSnapshot("ok", 0)
    token.assert_called_once()


def test_expired_token_is_refreshed(monkeypatch, credentials):
    _, token, _ = mock_http(monkeypatch)
    source = SpotifySnapshots("own")
    source.get("label")
    source.token_expires_at = 0
    assert source.get("label") == PlaylistSnapshot("snapshot", 2)
    assert token.call_count == 2


@pytest.mark.parametrize("config,dataset,expected", [
    ("config/playlists.csv", None, "own"),
    ("config/competitor_playlists.csv", None, "competitor"),
    ("config/COMPETITOR.csv", None, "competitor"),
    ("competitor/playlists.csv", None, "own"),
    ("config/competitor_playlists.csv", "own", "own"),
    ("config/playlists.csv", "competitor", "competitor"),
])
def test_dataset_resolution(config, dataset, expected):
    assert resolve_dataset(config, dataset) == expected


def test_skip_requires_snapshot_and_matching_task(tmp_path, task):
    state = SyncState(str(tmp_path / "state.json"))
    snapshot = PlaylistSnapshot("current", 2)
    assert not state.should_skip(task, snapshot)
    state.complete(task, snapshot, successful=True, track_count=2)
    assert state.should_skip(task, snapshot)
    assert not state.should_skip(task, None)
    assert not state.should_skip(task, PlaylistSnapshot("changed", 2))
    assert not state.should_skip(task, snapshot, full=True)
    for field in ("dashboard_name", "sot_playlist_id"):
        saved = state.entries[task.playlist_key][field]
        state.entries[task.playlist_key][field] = "changed"
        assert not state.should_skip(task, snapshot)
        state.entries[task.playlist_key][field] = saved


@pytest.mark.parametrize("successful,snapshot,count,recorded", [
    (True, PlaylistSnapshot("id", 2), 2, True),
    (True, PlaylistSnapshot("empty", 0), 0, True),
    (True, PlaylistSnapshot("id", 2), 1, False),
    (True, PlaylistSnapshot("id", 2), 3, False),
    (False, PlaylistSnapshot("id", 2), 2, False),
    (True, None, 2, False),
])
def test_checkpoint_conditions_remove_old_entries(tmp_path, task, successful, snapshot, count, recorded):
    path = tmp_path / "nested" / "state.json"
    state = SyncState(str(path))
    state.entries = {task.playlist_key: {"snapshot_id": "old"}, "other": {"snapshot_id": "keep"}}
    state.complete(task, snapshot, successful=successful, track_count=count)
    written = json.loads(path.read_text())
    assert (task.playlist_key in written) == recorded
    assert written["other"] == {"snapshot_id": "keep"}
    if recorded:
        assert set(written[task.playlist_key]) == {
            "snapshot_id", "tracks_total", "dashboard_name", "sot_playlist_id", "synced_at",
        }
        assert written[task.playlist_key]["tracks_total"] == count
        assert written[task.playlist_key]["synced_at"].endswith("+00:00")
    assert not list(path.parent.glob("*.tmp"))


def test_invalidation_is_persisted_before_browser_work(tmp_path, task):
    path = tmp_path / "state.json"
    state = SyncState(str(path))
    state.complete(task, PlaylistSnapshot("id", 2), successful=True, track_count=2)
    state.invalidate(task.playlist_key)
    assert json.loads(path.read_text()) == {}


@pytest.mark.parametrize("existing", [False, True])
def test_dry_run_never_writes(tmp_path, task, existing):
    path = tmp_path / "state.json"
    if existing:
        path.write_text('{"label": {"snapshot_id": "old"}}')
    original = path.read_bytes() if existing else None
    state = SyncState(str(path), dry_run=True)
    state.invalidate(task.playlist_key)
    state.complete(task, PlaylistSnapshot("id", 2), successful=True, track_count=2)
    state.persist()
    assert (path.read_bytes() if path.exists() else None) == original


@pytest.mark.parametrize("contents", ["invalid json", "[]", '{"label": null}', '{"label": "invalid"}'])
def test_bad_state_fails_open(tmp_path, task, contents):
    path = tmp_path / "state.json"
    path.write_text(contents)
    assert not SyncState(str(path)).should_skip(task, PlaylistSnapshot("id", 2))


def test_atomic_write_failure_preserves_existing_file_and_cleans_temp(tmp_path, task, monkeypatch, capsys):
    path = tmp_path / "state.json"
    path.write_text('{"old": {}}')
    state = SyncState(str(path))
    replace = Mock(side_effect=OSError("cannot replace"))
    monkeypatch.setattr("scripts.sot_sync_state.os.replace", replace)
    state.complete(task, PlaylistSnapshot("id", 2), successful=True, track_count=2)
    assert json.loads(path.read_text()) == {"old": {}}
    assert "cannot write state" in capsys.readouterr().out
    assert not list(tmp_path.glob("*.tmp"))


def test_unwritable_state_parent_fails_open(tmp_path, capsys):
    parent = tmp_path / "file"
    parent.write_text("not a directory")
    SyncState(str(parent / "state.json")).persist()
    assert "cannot write state" in capsys.readouterr().out
