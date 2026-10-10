import unittest
import json
import os
import tempfile
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest

from scripts.sot_sync_state import PlaylistSnapshot, SyncState

from scripts.sot_sync_dashboards import (
    extract_unique_hrefs,
    scan_dashboard_tracks,
    scan_playlist_tracks,
    should_skip_empty_dashboard,
    wait_for_tracks_or_empty_state,
    confirmed_empty_page,
    load_sync_tasks,
    run_sync,
    scan_with_retry,
    SyncTask,
)


class EmptyDashboardSafetyTests(unittest.TestCase):
    def test_allows_bootstrap_when_playlist_has_tracks(self):
        self.assertFalse(should_skip_empty_dashboard(dashboard_count=0, playlist_count=123))

    def test_skips_when_both_dashboard_and_playlist_are_empty(self):
        self.assertTrue(should_skip_empty_dashboard(dashboard_count=0, playlist_count=0))

    def test_does_not_skip_non_empty_dashboard(self):
        self.assertFalse(should_skip_empty_dashboard(dashboard_count=5, playlist_count=123))


class TrackTableScanTests(unittest.TestCase):
    def test_scans_exclude_sidebar_links_and_preserve_table_tracks(self):
        for scan in (scan_dashboard_tracks, scan_playlist_tracks):
            for table_tracks in ([], ["https://www.spotontrack.com/tracks/123"]):
                with self.subTest(scan=scan.__name__, table_tracks=table_tracks):
                    page = Mock()
                    sidebar_tracks = ["https://www.spotontrack.com/tracks/999"]
                    page.eval_on_selector_all.side_effect = lambda selector, js: (
                        table_tracks if selector == "table a[href*='/tracks/']" else table_tracks + sidebar_tracks
                    )
                    page.locator.return_value.count.return_value = len(table_tracks)
                    with patch("scripts.sot_sync_dashboards.goto_best_effort"), patch(
                        "scripts.sot_sync_dashboards.fast_pause"
                    ), patch("scripts.sot_sync_dashboards.wait_for_tracks_or_empty_state"):
                        self.assertEqual(set(scan(page, "https://www.spotontrack.com/test")), set(table_tracks))
                    if scan == scan_dashboard_tracks:
                        page.locator.assert_called_with("table a[href*='/tracks/']")

    def test_readiness_ignores_sidebar_and_accepts_explicit_empty_dashboard(self):
        page = Mock()
        page.locator.return_value.count.return_value = 0
        page.get_by_role.return_value.is_visible.return_value = True
        with patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=False):
            wait_for_tracks_or_empty_state(page)
        page.locator.assert_called_once_with("table a[href*='/tracks/']")
        page.get_by_role.assert_called_once_with("heading", name="No items in this dashboard", exact=True)

    def test_extraction_deduplicates_and_rejects_non_track_urls(self):
        page = Mock()
        page.eval_on_selector_all.return_value = [
            "https://www.spotontrack.com/tracks/123?source=playlist",
            "https://www.spotontrack.com/tracks/123/",
            "https://www.spotontrack.com/playlists/spotify/123/tracks",
        ]
        self.assertEqual(extract_unique_hrefs(page, ["table a[href*='/tracks/']"]), ["https://www.spotontrack.com/tracks/123"])


class ExpectedEmptySyncTests(unittest.TestCase):
    def test_empty_playlist_table_requires_explicit_empty_message(self):
        page = Mock()
        page.url = "https://example.com/playlist"
        tracks, table = Mock(), Mock()
        tracks.count.return_value = 0
        table.count.return_value = 1
        page.locator.side_effect = lambda selector: table if selector == "table" else tracks
        page.get_by_role.return_value.is_visible.return_value = True
        updated, loading = Mock(), Mock()
        updated.first.is_visible.return_value = True
        loading.first.is_visible.return_value = False
        page.get_by_text.side_effect = lambda pattern: loading if "Loading" in pattern.pattern else updated
        with patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=False):
            table.get_by_text.return_value.is_visible.return_value = True
            self.assertTrue(confirmed_empty_page(page, page.url, dashboard=False))
            table.get_by_text.assert_called_with("It looks like this playlist was empty at this date.", exact=True)
            table.get_by_text.return_value.is_visible.return_value = False
            self.assertFalse(confirmed_empty_page(page, page.url, dashboard=False))
            table.get_by_text.return_value.is_visible.return_value = True
            tracks.count.return_value = 1
            self.assertFalse(confirmed_empty_page(page, page.url, dashboard=False))

    def test_config_only_allows_explicit_non_catalog_zero_minimum(self):
        with tempfile.TemporaryDirectory() as td:
            config = Path(td) / "playlists.csv"
            config.write_text(
                "playlist_key,display_name,dashboard_url,sot_playlist_id,is_catalog,min_rows,allow_empty\n"
                "allowed,Allowed,https://example.com/1,1,false,,true\n"
                "catalog,Catalog,https://example.com/2,2,true,,true\n"
                "minimum,Minimum,https://example.com/3,3,false,1,true\n"
                "normal,Normal,https://example.com/4,4,false,,\n"
            )
            self.assertEqual([t.allow_empty for t in load_sync_tasks(str(config))], [True, False, False, False])

    def test_expected_empty_scan_returns_without_retry_or_refresh(self):
        page = Mock()
        scan = Mock(return_value=[])
        self.assertEqual(scan_with_retry(scan, page, "url", refresh=True, empty_check=lambda: True), [])
        scan.assert_called_once()
        page.reload.assert_not_called()
        page.get_by_role.assert_not_called()

    def test_scan_errors_are_not_accepted_as_empty(self):
        page = Mock()
        scan = Mock(side_effect=RuntimeError("scan failed"))
        empty_check = Mock(return_value=True)
        with patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=False), patch(
            "scripts.sot_sync_dashboards.fast_pause"
        ):
            self.assertIsNone(scan_with_retry(scan, page, "url", max_attempts=2, empty_check=empty_check))
        self.assertEqual(scan.call_count, 2)
        empty_check.assert_not_called()

    def test_confirmation_rejects_wrong_page_blocked_and_populated_pages(self):
        page = Mock()
        page.url = "https://example.com/dashboard"
        page.locator.return_value.count.return_value = 0
        page.get_by_role.return_value.is_visible.return_value = True
        with patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=False):
            self.assertTrue(confirmed_empty_page(page, page.url, dashboard=True))
            self.assertFalse(confirmed_empty_page(page, "https://example.com/other", dashboard=True))
            page.locator.return_value.count.return_value = 1
            self.assertFalse(confirmed_empty_page(page, page.url, dashboard=True))
        with patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=True):
            self.assertFalse(confirmed_empty_page(page, page.url, dashboard=True))

    def test_playlist_confirmation_requires_loaded_controls_and_no_loading_state(self):
        page = Mock()
        page.url = "https://example.com/playlist"
        page.locator.return_value.count.return_value = 0
        page.get_by_role.return_value.is_visible.return_value = True
        updated, loading = Mock(), Mock()
        updated.first.is_visible.return_value = True
        loading.first.is_visible.return_value = False
        def matching_text(pattern):
            if pattern.search("Loading tracks"):
                return loading
            self.assertIsNotNone(pattern.search("Updated 5 minutes ago"))
            return updated

        page.get_by_text.side_effect = matching_text
        with patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=False):
            self.assertTrue(confirmed_empty_page(page, page.url, dashboard=False))
            loading.first.is_visible.return_value = True
            self.assertFalse(confirmed_empty_page(page, page.url, dashboard=False))
            loading.first.is_visible.return_value = False
            updated.first.is_visible.return_value = False
            self.assertFalse(confirmed_empty_page(page, page.url, dashboard=False))

    def test_run_summary_only_suppresses_expected_confirmed_empty(self):
        for allowed, confirmed, populated_dashboard in ((True, True, False), (False, True, False), (True, False, False), (True, True, True)):
            expected = allowed and confirmed and not populated_dashboard
            with self.subTest(allowed=allowed, confirmed=confirmed, populated_dashboard=populated_dashboard):
                with tempfile.TemporaryDirectory() as td, ExitStack() as stack:
                    previous_cwd = os.getcwd()
                    os.chdir(td)
                    stack.callback(os.chdir, previous_cwd)
                    task = SyncTask("test", "Test", "https://example.com/dashboard", "Test", "123", allow_empty=allowed)
                    pw = stack.enter_context(patch("scripts.sot_sync_dashboards.sync_playwright"))
                    page = pw.return_value.__enter__.return_value.chromium.launch.return_value.new_context.return_value.new_page.return_value
                    page.url = "https://example.com/dashboard"
                    stack.enter_context(patch("scripts.sot_sync_dashboards.load_sync_tasks", return_value=[task]))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.enable_turbo_blocking"))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.is_logged_out", return_value=False))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.page_looks_blocked", return_value=False))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.confirmed_empty_page", return_value=confirmed))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.fast_pause"))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.time.sleep"))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.try_click_refresh_now"))
                    stack.enter_context(patch("scripts.sot_sync_dashboards.debug_dump", return_value=("", "")))
                    dashboard_scan = stack.enter_context(patch("scripts.sot_sync_dashboards.scan_dashboard_tracks", return_value={"track"} if populated_dashboard else set()))
                    playlist_scan = stack.enter_context(patch("scripts.sot_sync_dashboards.scan_playlist_tracks", return_value=[]))
                    stack.enter_context(patch("builtins.print"))
                    result = run_sync(config_path="unused", storage_state_path="", headless=True, dry_run=True, no_sync=False, limit=None, only_playlist_keys=None, fail_on_errors=True)
                    summary = json.loads(Path(".artifacts/sync_summary.json").read_text())
                    self.assertEqual(result, 0)
                    self.assertEqual(summary["total_expected_empty"], int(expected))
                    self.assertEqual(summary["total_skipped"], int(not expected))
                    self.assertEqual(summary["total_errors"], 0)
                    self.assertEqual(summary["total_removed"], 0)
                    if expected:
                        dashboard_scan.assert_called_once()
                        playlist_scan.assert_called_once()


@pytest.fixture
def state_run(tmp_path, monkeypatch):
    """Exercise the real task loop with no HTTP or browser."""
    import scripts.sot_sync_dashboards as sync

    monkeypatch.chdir(tmp_path)
    task = SyncTask("test", "Test", "https://example.com/dashboard", "Dashboard", "123")
    tasks = [task]
    playwright = MagicMock()
    source = Mock()
    source.get.return_value = PlaylistSnapshot("current", 1)
    source_factory = Mock(return_value=source)
    dashboard = Mock(return_value={"one"})
    playlist = Mock(return_value=["one"])
    toggle = Mock(return_value="toggled")
    monkeypatch.setattr(sync, "sync_playwright", playwright)
    monkeypatch.setattr(sync, "SpotifySnapshots", source_factory)
    monkeypatch.setattr(sync, "load_sync_tasks", lambda path: tasks)
    monkeypatch.setattr(sync, "scan_dashboard_tracks", dashboard)
    monkeypatch.setattr(sync, "scan_playlist_tracks", playlist)
    monkeypatch.setattr(sync, "click_dashboard_toggle", toggle)
    monkeypatch.setattr(sync, "is_logged_out", lambda page: False)
    monkeypatch.setattr(sync, "page_looks_blocked", lambda page: False)
    monkeypatch.setattr(sync, "confirmed_empty_page", lambda *args, **kwargs: True)
    monkeypatch.setattr(sync, "debug_dump", lambda *args: ("", ""))
    monkeypatch.setattr(sync, "fast_pause", lambda *args: None)
    monkeypatch.setattr(sync, "enable_turbo_blocking", lambda context: None)
    monkeypatch.setattr(sync.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(sync, "try_click_refresh_now", lambda page: False)
    path = tmp_path / "state.json"

    def run(**kwargs):
        options = dict(
            config_path="config/playlists.csv", storage_state_path="", headless=True,
            no_sync=False, dry_run=False, limit=None, only_playlist_keys=None,
            fail_on_errors=True, state_file=str(path),
        )
        options.update(kwargs)
        return run_sync(**options)

    def seed(snapshot="current"):
        state = SyncState(str(path))
        state.complete(task, PlaylistSnapshot(snapshot, 1), successful=True, track_count=1)

    return SimpleNamespace(
        run=run, seed=seed, task=task, tasks=tasks, path=path, source=source,
        source_factory=source_factory, playwright=playwright, dashboard=dashboard,
        playlist=playlist, toggle=toggle,
        summary=lambda: json.loads((tmp_path / ".artifacts/sync_summary.json").read_text()),
    )


def test_unchanged_run_has_no_browser_and_no_alert_counters(state_run, capsys):
    state_run.seed()
    original = state_run.path.read_bytes()
    assert state_run.run() == 0
    state_run.playwright.assert_not_called()
    state_run.dashboard.assert_not_called()
    state_run.playlist.assert_not_called()
    assert "[skip-unchanged] test" in capsys.readouterr().out
    assert state_run.summary() == {
        "total_added": 0, "total_removed": 0, "total_errors": 0,
        "total_skipped": 0, "total_expected_empty": 0, "tasks_total": 1,
        "skipped_unchanged": 1,
    }
    assert state_run.path.read_bytes() == original


@pytest.mark.parametrize("change", ["snapshot_id", "dashboard_name", "sot_playlist_id", "full"])
def test_changed_identity_or_full_runs_and_checkpoints(state_run, change):
    state_run.seed()
    if change == "snapshot_id":
        state_run.source.get.return_value = PlaylistSnapshot("new", 1)
    elif change != "full":
        entries = json.loads(state_run.path.read_text())
        entries["test"][change] = "old"
        state_run.path.write_text(json.dumps(entries))
    assert state_run.run(full=change == "full") == 0
    state_run.dashboard.assert_called_once()
    state_run.playlist.assert_called_once()
    assert state_run.summary()["skipped_unchanged"] == 0
    entry = json.loads(state_run.path.read_text())["test"]
    assert entry["snapshot_id"] == state_run.source.get.return_value.snapshot_id
    assert entry["dashboard_name"] == state_run.task.dashboard_name
    assert entry["sot_playlist_id"] == state_run.task.sot_playlist_id


def test_state_feature_disabled_makes_no_snapshot_calls(state_run):
    assert state_run.run(state_file=None) == 0
    state_run.source_factory.assert_not_called()
    state_run.source.get.assert_not_called()
    state_run.dashboard.assert_called_once()
    assert not state_run.path.exists()
    assert state_run.summary()["skipped_unchanged"] == 0


def test_missing_signal_syncs_normally_and_clears_old_state(state_run):
    state_run.seed()
    state_run.source.get.return_value = None
    assert state_run.run() == 0
    state_run.dashboard.assert_called_once()
    state_run.playlist.assert_called_once()
    assert json.loads(state_run.path.read_text()) == {}
    assert state_run.summary()["skipped_unchanged"] == 0


def test_missing_credentials_fail_open_in_task_loop(state_run, monkeypatch, capsys):
    from scripts.sot_sync_state import SpotifySnapshots

    monkeypatch.setattr("scripts.sot_sync_dashboards.SpotifySnapshots", SpotifySnapshots)
    for name in ("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name, raising=False)
    state_run.seed()
    assert state_run.run() == 0
    state_run.playlist.assert_called_once()
    assert "Warning" in capsys.readouterr().out
    assert json.loads(state_run.path.read_text()) == {}


@pytest.mark.parametrize("successful", [True, False])
@pytest.mark.parametrize("operation", ["add", "remove"])
def test_add_remove_errors_control_checkpoint(state_run, successful, operation):
    state_run.seed("old")
    if operation == "add":
        state_run.dashboard.return_value = {"extra"}
        state_run.playlist.return_value = ["extra", "one"]
        state_run.source.get.return_value = PlaylistSnapshot("current", 2)
    else:
        state_run.dashboard.return_value = {"extra", "one"}
    state_run.toggle.return_value = "toggled" if successful else "failed"
    assert state_run.run() == (0 if successful else 10)
    assert ("test" in json.loads(state_run.path.read_text())) == successful
    assert state_run.summary()["total_errors"] == int(not successful)
    assert state_run.summary()["total_added" if operation == "add" else "total_removed"] == int(successful)


def test_count_mismatch_clears_state_and_does_not_alert(state_run, capsys):
    state_run.seed("old")
    state_run.source.get.return_value = PlaylistSnapshot("current", 2)
    assert state_run.run() == 0
    assert json.loads(state_run.path.read_text()) == {}
    assert "SOT count 1 differs from Spotify count 2" in capsys.readouterr().out
    assert state_run.summary()["total_skipped"] == 0
    assert state_run.summary()["total_errors"] == 0


@pytest.mark.parametrize("scenario", ["empty", "minimum", "mass_removal"])
def test_safety_skips_clear_old_state(state_run, scenario):
    state_run.seed("old")
    if scenario == "empty":
        state_run.playlist.return_value = []
    elif scenario == "minimum":
        state_run.tasks[0] = SyncTask("test", "Test", "url", "Dashboard", "123", min_rows=2)
    else:
        state_run.dashboard.return_value = {str(index) for index in range(200)}
    assert state_run.run() == 0
    assert json.loads(state_run.path.read_text()) == {}
    assert state_run.summary()["total_skipped"] == 1
    assert state_run.summary()["skipped_unchanged"] == 0
    state_run.toggle.assert_not_called()


@pytest.mark.parametrize("spotify_total", [0, 1])
def test_confirmed_empty_checkpoint_needs_spotify_zero(state_run, spotify_total):
    state_run.seed("old")
    state_run.tasks[0] = SyncTask("test", "Test", "url", "Dashboard", "123", allow_empty=True)
    state_run.dashboard.return_value = set()
    state_run.playlist.return_value = []
    state_run.source.get.return_value = PlaylistSnapshot("current", spotify_total)
    assert state_run.run() == 0
    assert state_run.summary()["total_expected_empty"] == 1
    assert ("test" in json.loads(state_run.path.read_text())) == (spotify_total == 0)


def test_dashboard_scan_error_cannot_checkpoint_bootstrap(state_run):
    state_run.seed("old")
    state_run.dashboard.side_effect = RuntimeError("failed scan")
    assert state_run.run() == 0
    assert json.loads(state_run.path.read_text()) == {}


@pytest.mark.parametrize("extras", [True, False])
def test_no_sync_keeps_add_only_behavior_and_requires_complete_mirror(state_run, extras):
    state_run.seed("old")
    state_run.dashboard.return_value = {"extra"} if extras else set()
    assert state_run.run(no_sync=True) == 0
    assert state_run.summary()["total_added"] == 1
    assert state_run.summary()["total_removed"] == 0
    assert ("test" in json.loads(state_run.path.read_text())) == (not extras)
    state_run.toggle.assert_called_once()


@pytest.mark.parametrize("existing", [True, False])
def test_dry_run_does_not_write_or_invalidate_state(state_run, existing):
    if existing:
        state_run.seed("old")
    original = state_run.path.read_bytes() if existing else None
    state_run.dashboard.return_value = {"extra"}
    assert state_run.run(dry_run=True, full=True) == 0
    assert (state_run.path.read_bytes() if state_run.path.exists() else None) == original
    state_run.toggle.assert_not_called()


def test_checkpoints_survive_later_task_crash(state_run, monkeypatch):
    state_run.seed("old")
    second = SyncTask("second", "Second", "url", "Dashboard", "456")
    state_run.tasks.append(second)
    state = SyncState(str(state_run.path))
    state.complete(second, PlaylistSnapshot("old", 1), successful=True, track_count=1)
    calls = 0

    def scan(scan_function, page, url, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 3:
            written = json.loads(state_run.path.read_text())
            assert written["test"]["snapshot_id"] == "current"
            assert "second" not in written
            raise RuntimeError("interrupted second task")
        return ["one"]

    monkeypatch.setattr("scripts.sot_sync_dashboards.scan_with_retry", scan)
    with pytest.raises(RuntimeError, match="interrupted second task"):
        state_run.run()
    assert json.loads(state_run.path.read_text())["test"]["snapshot_id"] == "current"


def test_mixed_run_navigates_only_changed_tasks(state_run):
    state_run.seed()
    state_run.tasks.extend([
        SyncTask(f"unchanged{index}", "Unchanged", "url", "Dashboard", "123") for index in range(4)
    ])
    state_run.tasks.append(SyncTask("changed", "Changed", "url", "Dashboard", "456"))
    state = SyncState(str(state_run.path))
    for task in state_run.tasks[1:-1]:
        state.complete(task, PlaylistSnapshot("current", 1), successful=True, track_count=1)
    assert state_run.run() == 0
    state_run.dashboard.assert_called_once()
    state_run.playlist.assert_called_once()
    browser = state_run.playwright.return_value.__enter__.return_value.chromium.launch.return_value
    # Skipped tasks do not trigger context rotation or warm-up navigations.
    browser.new_context.assert_called_once()
    browser.new_context.return_value.new_page.return_value.goto.assert_called_once()
    assert state_run.summary()["skipped_unchanged"] == 5
    assert state_run.summary()["tasks_total"] == 6


@pytest.mark.parametrize("config,dataset,expected", [
    ("config/playlists.csv", None, "own"),
    ("config/competitor_playlists.csv", None, "competitor"),
    ("config/competitor_playlists.csv", "own", "own"),
])
def test_run_uses_resolved_dataset(state_run, config, dataset, expected):
    assert state_run.run(config_path=config, dataset=dataset) == 0
    state_run.source_factory.assert_called_once_with(expected)


if __name__ == "__main__":
    unittest.main()
