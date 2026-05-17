import unittest

from scripts.enrich_competitor_tracks_with_spotify import Postgrest, candidate_filters


class CompetitorSpotifyEnrichmentTests(unittest.TestCase):
    def test_postgrest_uses_competitor_schema_headers(self):
        pg = Postgrest("https://example.supabase.co", "secret")

        self.assertEqual(pg.h["Accept-Profile"], "competitor")
        self.assertEqual(pg.h["Content-Profile"], "competitor")

    def test_candidate_filters_prioritize_missing_artist_ids(self):
        self.assertEqual(
            candidate_filters(250),
            [
                "order=spotify_artist_ids.nullsfirst,last_seen.desc",
                "limit=250",
            ],
        )


if __name__ == "__main__":
    unittest.main()
