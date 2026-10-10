import unittest
import json
import os
import tempfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

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


if __name__ == "__main__":
    unittest.main()
