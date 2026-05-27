from scripts.refresh_competitor_playlist_thumbnails import has_missing_image_filter, playlist_key_filter


def test_has_missing_image_filter_skips_when_forcing():
    assert has_missing_image_filter(True) is None


def test_has_missing_image_filter_limits_to_null_images_by_default():
    assert has_missing_image_filter(False) == "spotify_playlist_image_url=is.null"


def test_playlist_key_filter_ignores_blank_values():
    assert playlist_key_filter(["soave", " ", "selected"]) == 'playlist_key=in.("soave","selected")'


def test_playlist_key_filter_returns_none_without_values():
    assert playlist_key_filter(["", " "]) is None
