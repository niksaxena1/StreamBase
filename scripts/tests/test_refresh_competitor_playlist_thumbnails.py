from scripts.refresh_competitor_playlist_thumbnails import (
    has_missing_image_filter,
    is_owned_playlist_image_url,
    playlist_key_filter,
)


def test_has_missing_image_filter_skips_when_forcing():
    assert has_missing_image_filter(True) is None


def test_has_missing_image_filter_limits_to_null_images_by_default():
    assert has_missing_image_filter(False) == "spotify_playlist_image_url=is.null"


def test_playlist_key_filter_ignores_blank_values():
    assert playlist_key_filter(["soave", " ", "selected"]) == 'playlist_key=in.("soave","selected")'


def test_playlist_key_filter_returns_none_without_values():
    assert playlist_key_filter(["", " "]) is None


def test_owned_playlist_image_urls_are_local_or_storage():
    assert is_owned_playlist_image_url("/playlist-logos/landr.png") is True
    assert (
        is_owned_playlist_image_url(
            "https://example.supabase.co/storage/v1/object/public/playlist-logos/tg_amuse.jpg"
        )
        is True
    )
    assert is_owned_playlist_image_url("https://mosaic.scdn.co/640/abc") is False
    assert is_owned_playlist_image_url(None) is False
