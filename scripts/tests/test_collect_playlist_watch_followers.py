import unittest

from scripts.collect_playlist_watch_followers import (
    Postgrest,
    SpotifyApiError,
    build_snapshot_row,
    parse_spotify_playlist_id,
    playlist_status_for_error,
)


class PlaylistWatchCollectorTests(unittest.TestCase):
    def test_parse_spotify_playlist_id_accepts_url_uri_and_raw_id(self):
        self.assertEqual(
            parse_spotify_playlist_id("https://open.spotify.com/playlist/5iZWReTEt9VqKeDWIHmcYi?si=abc"),
            "5iZWReTEt9VqKeDWIHmcYi",
        )
        self.assertEqual(parse_spotify_playlist_id("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), "37i9dQZF1DXcBWIGoYBM5M")
        self.assertEqual(parse_spotify_playlist_id("4rnleEAOdmFAbRcNCgZMpY"), "4rnleEAOdmFAbRcNCgZMpY")

    def test_parse_spotify_playlist_id_rejects_non_playlist_values(self):
        self.assertIsNone(parse_spotify_playlist_id(""))
        self.assertIsNone(parse_spotify_playlist_id("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl"))
        self.assertIsNone(parse_spotify_playlist_id("not a playlist id"))

    def test_postgrest_uses_playlist_watch_schema_headers(self):
        pg = Postgrest("https://example.supabase.co", "secret")

        self.assertEqual(pg.h["Accept-Profile"], "playlist_watch")
        self.assertEqual(pg.h["Content-Profile"], "playlist_watch")

    def test_playlist_status_for_error_maps_recoverable_statuses(self):
        self.assertEqual(playlist_status_for_error(SpotifyApiError(404, "missing")), "spotify_404")
        self.assertEqual(playlist_status_for_error(SpotifyApiError(429, "rate limit")), "rate_limited")
        self.assertEqual(playlist_status_for_error(SpotifyApiError(403, "forbidden")), "unavailable")
        self.assertEqual(playlist_status_for_error(RuntimeError("boom")), "unavailable")

    def test_build_snapshot_row_keeps_daily_row_narrow(self):
        row = build_snapshot_row(
            run_date="2026-05-22",
            spotify_playlist_id="4rnleEAOdmFAbRcNCgZMpY",
            follower_count=3224,
            source_run_id=12,
            source="spotify_api",
        )

        self.assertEqual(
            row,
            {
                "date": "2026-05-22",
                "spotify_playlist_id": "4rnleEAOdmFAbRcNCgZMpY",
                "follower_count": 3224,
                "source_run_id": 12,
                "source": "spotify_api",
            },
        )


if __name__ == "__main__":
    unittest.main()
