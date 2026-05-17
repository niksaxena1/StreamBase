import unittest

from scripts.sot_sync_dashboards import should_skip_empty_dashboard


class EmptyDashboardSafetyTests(unittest.TestCase):
    def test_allows_bootstrap_when_playlist_has_tracks(self):
        self.assertFalse(should_skip_empty_dashboard(dashboard_count=0, playlist_count=123))

    def test_skips_when_both_dashboard_and_playlist_are_empty(self):
        self.assertTrue(should_skip_empty_dashboard(dashboard_count=0, playlist_count=0))

    def test_does_not_skip_non_empty_dashboard(self):
        self.assertFalse(should_skip_empty_dashboard(dashboard_count=5, playlist_count=123))


if __name__ == "__main__":
    unittest.main()
