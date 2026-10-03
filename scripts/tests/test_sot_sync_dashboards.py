import unittest
from unittest.mock import Mock, patch

from scripts.sot_sync_dashboards import (
    extract_unique_hrefs,
    scan_dashboard_tracks,
    scan_playlist_tracks,
    should_skip_empty_dashboard,
    wait_for_tracks_or_empty_state,
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


if __name__ == "__main__":
    unittest.main()
