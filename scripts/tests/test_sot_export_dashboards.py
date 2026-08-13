import tempfile
import unittest
from pathlib import Path

from scripts.sot_export_dashboards import filter_playlists_by_keys, load_playlists_csv


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


if __name__ == "__main__":
    unittest.main()
