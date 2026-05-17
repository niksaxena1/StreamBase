import tempfile
import unittest
from pathlib import Path

from scripts.ingest_competitor_exports_to_supabase import (
    COMPETITOR_TABLES,
    build_playlist_stats_row,
    load_playlists_csv,
)


class CompetitorIngestTests(unittest.TestCase):
    def test_load_competitor_playlists_csv_includes_label_key(self):
        with tempfile.TemporaryDirectory() as td:
            csv_path = Path(td) / "competitor_playlists.csv"
            csv_path.write_text(
                "playlist_key,display_name,label_key,is_catalog,playlist_type,dashboard_url\n"
                "paraiso_releases,Paraíso Releases,paraiso,true,Competitor,https://example.com/dashboard\n",
                encoding="utf-8",
            )

            rows = load_playlists_csv(str(csv_path))

        self.assertEqual(rows[0].playlist_key, "paraiso_releases")
        self.assertEqual(rows[0].label_key, "paraiso")

    def test_competitor_ingest_targets_competitor_tables(self):
        self.assertEqual(
            COMPETITOR_TABLES,
            {
                "tracks": "competitor.tracks",
                "track_daily_streams": "competitor.track_daily_streams",
                "playlist_memberships": "competitor.playlist_memberships",
                "playlist_daily_stats": "competitor.playlist_daily_stats",
            },
        )

    def test_build_playlist_stats_row_sums_streams(self):
        row = build_playlist_stats_row(
            run_date="2026-05-17",
            playlist_key="paraiso_releases",
            streams_by_isrc={"AA1": 100, "BB2": 300},
            all_isrcs={"AA1", "BB2", "CC3"},
            previous_total=250,
            source_run_id=7,
        )

        self.assertEqual(row["track_count"], 3)
        self.assertEqual(row["total_streams_cumulative"], 400)
        self.assertEqual(row["daily_streams_net"], 150)
        self.assertEqual(row["missing_streams_track_count"], 1)
        self.assertEqual(row["source_run_id"], 7)


if __name__ == "__main__":
    unittest.main()
