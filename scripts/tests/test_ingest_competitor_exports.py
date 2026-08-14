import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.ingest_competitor_exports_to_supabase import (
    COMPETITOR_TABLES,
    build_playlist_stats_row,
    date_batches,
    filter_playlists_by_keys,
    load_playlists_csv,
    normalize_competitor_analytics,
    parse_release_date,
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

    def test_filters_to_requested_competitor_playlist(self):
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

        self.assertEqual([playlist.playlist_key for playlist in filtered], ["musicup_releases"])

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

    def test_first_playlist_snapshot_uses_zero_daily_streams(self):
        row = build_playlist_stats_row(
            run_date="2026-08-12",
            playlist_key="musicup_releases",
            streams_by_isrc={"AA1": 100, "BB2": 300},
            all_isrcs={"AA1", "BB2"},
            previous_total=None,
            source_run_id=88,
        )

        self.assertEqual(row["total_streams_cumulative"], 400)
        self.assertEqual(row["daily_streams_net"], 0)

    def test_parse_release_date_keeps_valid_iso_dates(self):
        self.assertEqual(parse_release_date("2026-05-27"), "2026-05-27")

    def test_parse_release_date_drops_invalid_source_placeholders(self):
        self.assertIsNone(parse_release_date("0000-01-01"))
        self.assertIsNone(parse_release_date(""))

    def test_date_batches_cover_range_without_overlap(self):
        self.assertEqual(
            date_batches(date(2026, 8, 1), date(2026, 8, 8), 3),
            [
                (date(2026, 8, 1), date(2026, 8, 3)),
                (date(2026, 8, 4), date(2026, 8, 6)),
                (date(2026, 8, 7), date(2026, 8, 8)),
            ],
        )

    def test_normalization_recomputes_only_current_day_without_new_overrides(self):
        class FakePostgrest:
            def __init__(self):
                self.calls = []

            def rpc(self, name, params):
                self.calls.append((name, params))
                if name == "spotibase_reconcile_auto_overrides":
                    return 0
                if name == "spotibase_interpolate_stale_streams":
                    return [{"overrides_written": 0, "tracks_affected": 0}]
                if name == "spotibase_rebase_downward_revisions":
                    return [{"overrides_written": 0, "tracks_affected": 0}]
                if name == "spotibase_recompute_playlist_daily_stats_cascade":
                    return 1
                return 12

        pg = FakePostgrest()
        result = normalize_competitor_analytics(pg, date(2026, 8, 13))

        self.assertEqual(result["recompute_start"], "2026-08-13")
        self.assertIn(
            (
                "spotibase_recompute_playlist_daily_stats_cascade",
                {"p_start_date": "2026-08-13", "p_end_date": "2026-08-13"},
            ),
            pg.calls,
        )

    def test_normalization_cascades_from_lookback_when_overrides_are_written(self):
        class FakePostgrest:
            def __init__(self):
                self.calls = []

            def rpc(self, name, params):
                self.calls.append((name, params))
                if name == "spotibase_interpolate_stale_streams":
                    return [{"overrides_written": 20, "tracks_affected": 10}]
                if name == "spotibase_recompute_playlist_daily_stats_cascade":
                    return 15
                return 100

        pg = FakePostgrest()
        result = normalize_competitor_analytics(pg, date(2026, 8, 13))

        self.assertEqual(result["recompute_start"], "2026-07-30")
        artist_calls = [call for call in pg.calls if call[0] == "refresh_artist_daily_stats"]
        self.assertEqual(len(artist_calls), 5)


if __name__ == "__main__":
    unittest.main()
