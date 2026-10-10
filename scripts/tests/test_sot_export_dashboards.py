import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

from scripts.sot_export_dashboards import (
    EMPTY_EXPORT_COLUMNS,
    Playlist,
    count_csv_rows,
    download_one,
    download_with_retries,
    PWTimeout,
    filter_playlists_by_keys,
    load_playlists_csv,
)


class TargetedExportTests(unittest.TestCase):
    def test_filters_to_requested_playlist(self):
        with tempfile.TemporaryDirectory() as td:
            csv_path = Path(td) / "competitor_playlists.csv"
            csv_path.write_text(
                "playlist_key,display_name,label_key,is_catalog,playlist_type,dashboard_url\n"
                "musicup_releases,MusicUp Releases,musicup,true,Competitor,https://example.com/musicup\n"
                "paraiso_releases,Paraiso Releases,paraiso,true,Competitor,https://example.com/paraiso\n",
                encoding="utf-8",
            )
            playlists = load_playlists_csv(str(csv_path))

        filtered = filter_playlists_by_keys(playlists, {"musicup_releases"})

        self.assertEqual([playlist.key for playlist in filtered], ["musicup_releases"])


class EmptyExportTests(unittest.TestCase):
    def test_navigation_timeout_is_retried_then_succeeds(self):
        page = MagicMock()
        with patch("scripts.sot_export_dashboards.download_one", side_effect=[PWTimeout("navigation"), (True, "downloaded")]) as attempt, patch("scripts.sot_export_dashboards.time.sleep"):
            self.assertEqual(download_with_retries(page, None, Path("unused.csv")), (True, "downloaded"))
        self.assertEqual(attempt.call_count, 2)

    def test_persistent_timeout_returns_failure_after_bounded_retries(self):
        page = MagicMock()
        page.reload.side_effect = PWTimeout("reload")
        with patch("scripts.sot_export_dashboards.MAX_EXPORT_RETRIES", 2), patch("scripts.sot_export_dashboards.download_one", side_effect=PWTimeout("navigation")) as attempt, patch("scripts.sot_export_dashboards.time.sleep"):
            self.assertEqual(download_with_retries(page, None, Path("unused.csv")), (False, "failed_after_retries:page_timeout"))
        self.assertEqual(attempt.call_count, 2)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "empty.csv"
        self.page = MagicMock()
        self.page.url = "https://www.spotontrack.com/dashboard/91"
        self.page.get_by_role.return_value.is_visible.return_value = True
        self.page.locator.return_value.count.return_value = 0
        self.playlist = Playlist("tps_emubands", "TPS EmuBands", self.page.url, False, allow_empty=True)
        sleeper = patch("scripts.sot_export_dashboards.time.sleep")
        sleeper.start()
        self.addCleanup(sleeper.stop)

    def test_confirmed_empty_writes_header_without_waiting_for_export(self):
        with patch("scripts.sot_export_dashboards.wait_for_export_button") as wait:
            self.assertEqual(download_one(self.page, self.playlist, self.path), (True, "confirmed_empty_dashboard"))
        wait.assert_not_called()
        self.assertEqual(count_csv_rows(self.path), 0)
        self.assertEqual(self.path.read_text().strip(), ",".join(EMPTY_EXPORT_COLUMNS))
        self.page.get_by_role.assert_called_with("heading", name="No items in this dashboard", exact=True)
        self.page.expect_download.assert_not_called()

    def test_missing_button_without_empty_state_fails_without_overwriting(self):
        self.page.get_by_role.return_value.is_visible.return_value = False
        self.path.write_text("previous export")
        with patch("scripts.sot_export_dashboards.wait_for_export_button", return_value=False):
            self.assertEqual(download_one(self.page, self.playlist, self.path), (False, "export_button_not_visible"))
        self.assertEqual(self.path.read_text(), "previous export")

    def test_track_rows_contradict_empty_heading(self):
        self.page.locator.return_value.count.return_value = 2
        with patch("scripts.sot_export_dashboards.wait_for_export_button", return_value=False):
            self.assertFalse(download_one(self.page, self.playlist, self.path)[0])
        self.assertFalse(self.path.exists())

    def test_unapproved_catalog_and_minimum_row_playlists_fail(self):
        for options in ({}, {"is_catalog": True, "allow_empty": True}, {"min_rows": 1, "allow_empty": True}):
            with self.subTest(options=options):
                fields = {"is_catalog": False, **options}
                playlist = Playlist("test", "Test", self.page.url, **fields)
                self.assertEqual(download_one(self.page, playlist, self.path), (False, "empty_dashboard_not_allowed"))
                self.assertFalse(self.path.exists())

    def test_logged_out_page_is_never_accepted_as_empty(self):
        self.page.url = "https://www.spotontrack.com/login"
        self.assertEqual(download_one(self.page, self.playlist, self.path), (False, "logged_out"))
        self.assertFalse(self.path.exists())

    def test_late_empty_state_is_recognized_after_wait(self):
        self.page.get_by_role.return_value.is_visible.side_effect = [False, True]
        with patch("scripts.sot_export_dashboards.wait_for_export_button", return_value=False):
            self.assertEqual(download_one(self.page, self.playlist, self.path), (True, "confirmed_empty_dashboard"))

    def test_populated_allowlisted_dashboard_still_downloads(self):
        self.page.get_by_role.return_value.is_visible.return_value = False
        download = self.page.expect_download.return_value.__enter__.return_value.value
        download.save_as.side_effect = lambda path: Path(path).write_text("isrc,name\nTEST,Track\n")
        with patch("scripts.sot_export_dashboards.wait_for_export_button", return_value=True), patch(
            "scripts.sot_export_dashboards.click_export_csv", return_value=True
        ):
            self.assertEqual(download_one(self.page, self.playlist, self.path), (True, "downloaded"))
        self.assertEqual(count_csv_rows(self.path), 1)

    def test_only_confirmed_distributor_exemptions_are_configured(self):
        config = Path(__file__).resolve().parents[2] / "config" / "playlists.csv"
        playlists = load_playlists_csv(str(config))
        self.assertEqual({p.key for p in playlists if p.allow_empty}, {"fh_offstep", "tps_emubands", "ghr_emubands"})
        self.assertFalse(any(p.allow_empty for p in playlists if p.is_catalog))


if __name__ == "__main__":
    unittest.main()
