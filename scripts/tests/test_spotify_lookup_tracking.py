"""Offline lookup lifecycle tests for both analytics universes."""

from datetime import datetime, timedelta, timezone
from unittest.mock import Mock
from urllib.parse import parse_qs

import pytest

from scripts import enrich_tracks_with_spotify as own
from scripts import enrich_competitor_tracks_with_spotify as competitor
from scripts import spotify_lookup_tracking as tracking


NOW = datetime(2026, 10, 11, 16, 30, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch):
    class Clock:
        @staticmethod
        def now(tz):
            return NOW

    monkeypatch.setattr(tracking, "datetime", Clock)


@pytest.fixture(params=[own, competitor], ids=["public", "competitor"])
def pipeline(request):
    return request.param


def run_batch(pipeline, row, hit=None, *, only_missing=False, pg=None):
    pg = pg or Mock()
    pg.select.return_value = [row]
    sp = Mock()
    sp.get_artists.return_value = []
    sp.find_track_by_isrc.return_value = hit
    if pipeline is competitor:
        pipeline.enrich_batch(pg, Mock(), sp, 10, only_missing=only_missing)
    else:
        pipeline.enrich_batch(pg, sp, 10, only_missing=only_missing)
    return pg, sp


def test_two_misses_confirm_absence(pipeline):
    row = {"isrc": "GBABC2600001", "spotify_lookup_misses": 0}
    pg, sp = run_batch(pipeline, row)
    first = pg.patch.call_args.args[1]
    assert first == {"spotify_lookup_misses": 1}
    sp.find_track_by_isrc.assert_called_once_with(row["isrc"])
    row.update(first)
    pg, _ = run_batch(pipeline, row)
    second = pg.patch.call_args.args[1]
    assert second["spotify_lookup_misses"] == 2
    assert second["spotify_not_found_since"] == NOW.isoformat()
    assert ("spotify_last_fetched_at" in second) == (pipeline is own)


def test_recheck_miss_restarts_monthly_window(pipeline):
    since = (NOW - timedelta(days=60)).isoformat()
    pg, _ = run_batch(pipeline, {
        "isrc": "GBABC2600001", "spotify_lookup_misses": 4,
        "spotify_not_found_since": since,
    })
    patch = pg.patch.call_args.args[1]
    assert patch["spotify_lookup_misses"] == 5
    if pipeline is own:
        assert "spotify_not_found_since" not in patch
        assert patch["spotify_last_fetched_at"] == NOW.isoformat()
    else:
        assert patch["spotify_not_found_since"] == NOW.isoformat()
        assert "spotify_last_fetched_at" not in patch


@pytest.mark.parametrize("only_missing", [False, True])
def test_selection_skips_confirmed_absences_until_recheck(pipeline, only_missing):
    pg = Mock()
    pg.select.return_value = []
    sp = Mock()
    sp.get_artists.return_value = []
    if pipeline is competitor:
        pipeline.enrich_batch(pg, Mock(), sp, 25, only_missing=only_missing)
    else:
        pipeline.enrich_batch(pg, sp, 25, only_missing=only_missing)
    _, columns, filters = pg.select.call_args.args
    query = parse_qs(filters)
    cutoff = "2026-09-11T16:30:00Z"
    if pipeline is own:
        assert query["or"] == [
            f"(spotify_not_found_since.is.null,and(spotify_not_found_since.lt.{cutoff},"
            f"or(spotify_last_fetched_at.is.null,spotify_last_fetched_at.lt.{cutoff})))"
        ]
    else:
        assert query["or"] == [f"(spotify_not_found_since.is.null,spotify_not_found_since.lt.{cutoff})"]
    assert (query.get("spotify_artist_ids") == ["is.null"]) == only_missing
    assert "spotify_lookup_misses" in columns
    assert "spotify_not_found_since" in columns
    sp.find_track_by_isrc.assert_not_called()


def test_hit_clears_tracking_and_saves_metadata(pipeline):
    hit = {"spotify_track_id": "restored", "spotify_artist_ids": ["artist"]}
    pg, _ = run_batch(pipeline, {
        "isrc": "GBABC2600001", "spotify_lookup_misses": 3,
        "spotify_not_found_since": "2026-08-01T00:00:00Z",
    }, hit)
    assert pg.patch.call_args_list[0].args[1] == hit
    assert pg.patch.call_args_list[1].args[1] == {
        "spotify_lookup_misses": 0, "spotify_not_found_since": None,
    }


@pytest.mark.parametrize("found", [False, True])
def test_tracking_write_failure_does_not_stop_batch(pipeline, found, capsys):
    pg = Mock()
    def patch_track(table, patch, filters):
        if "spotify_lookup_misses" in patch:
            raise RuntimeError("offline")

    pg.patch.side_effect = patch_track
    hit = {"spotify_track_id": "found"} if found else None
    run_batch(pipeline, {"isrc": "GBABC2600001", "spotify_lookup_misses": 1}, hit, pg=pg)
    output = capsys.readouterr().out
    assert "WARN Spotify lookup tracking" in output
    assert "fail=0" in output


@pytest.mark.parametrize("found", [False, True])
def test_explicit_single_lookup_also_tracks_results(pipeline, found):
    pg = Mock()
    row = {"isrc": "GBABC2600001", "spotify_lookup_misses": 2, "spotify_not_found_since": NOW.isoformat()}
    pg.select.return_value = [row]
    sp = Mock()
    sp.get_artists.return_value = []
    sp.find_track_by_isrc.return_value = {"spotify_track_id": "found"} if found else None
    if pipeline is competitor:
        pipeline.enrich_single(pg, Mock(), sp, "GBABC2600001")
    else:
        pipeline.enrich_single(pg, sp, "GBABC2600001")
    for call in pg.patch.call_args_list:
        row.update(call.args[1])
    assert row["spotify_lookup_misses"] == (0 if found else 2)
    assert row["spotify_not_found_since"] == (None if found else NOW.isoformat())


def test_spotify_errors_are_not_search_misses(pipeline, capsys):
    pg = Mock()
    pg.select.return_value = [{"isrc": "GBABC2600001"}]
    sp = Mock()
    sp.get_artists.return_value = []
    sp.find_track_by_isrc.side_effect = RuntimeError("rate limited")
    if pipeline is competitor:
        pipeline.enrich_batch(pg, Mock(), sp, 10)
    else:
        pipeline.enrich_batch(pg, sp, 10)
    pg.patch.assert_not_called()
    assert "fail=1" in capsys.readouterr().out


def test_healthy_hit_does_not_add_a_tracking_write(pipeline):
    hit = {"spotify_track_id": "found"}
    pg, _ = run_batch(pipeline, {
        "isrc": "GBABC2600001", "spotify_lookup_misses": 0,
        "spotify_not_found_since": None,
    }, hit)
    pg.patch.assert_called_once_with("tracks", hit, "isrc=eq.GBABC2600001")


@pytest.mark.parametrize("isrc", ["", "  ", "--- / !!!", "____"])
def test_empty_normalized_isrc_is_not_a_miss(pipeline, isrc, capsys):
    pg, sp = run_batch(pipeline, {"isrc": isrc, "spotify_lookup_misses": 1})
    pg.patch.assert_not_called()
    sp.find_track_by_isrc.assert_not_called()
    assert "miss=0" in capsys.readouterr().out
    spotify = pipeline.Spotify("offline", "offline")
    spotify.get = Mock()
    assert spotify.find_track_by_isrc(isrc) is None
    spotify.get.assert_not_called()


@pytest.mark.parametrize("body", [None, [], {}, {"tracks": None}, {"tracks": {}},
    {"tracks": {"items": None}}, {"tracks": {"items": {}}},
    {"tracks": {"items": "invalid"}}, {"tracks": {"items": [None]}}])
@pytest.mark.parametrize("after_valid_empty_search", [False, True])
def test_malformed_200_response_never_records_a_miss(pipeline, body, after_valid_empty_search, capsys):
    pg = Mock()
    pg.select.return_value = [{"isrc": "GB-ABC-26-00001", "spotify_lookup_misses": 1}]
    sp = pipeline.Spotify("offline", "offline")
    sp.get = Mock(side_effect=[{"tracks": {"items": []}}, body] if after_valid_empty_search else [body])
    sp.get_artists = Mock(return_value=[])
    if pipeline is competitor:
        pipeline.enrich_batch(pg, Mock(), sp, 10)
    else:
        pipeline.enrich_batch(pg, sp, 10)
    pg.patch.assert_not_called()
    assert "miss=0 fail=1" in capsys.readouterr().out


@pytest.mark.parametrize("misses,since", [(0, None), (1, None), (5, "2026-08-01T00:00:00Z")])
def test_manual_miss_preserves_existing_tracking(pipeline, misses, since):
    row = {"isrc": "GBABC2600001", "spotify_lookup_misses": misses, "spotify_not_found_since": since}
    pg = Mock()
    pg.select.return_value = [row]
    sp = Mock()
    sp.find_track_by_isrc.return_value = None
    if pipeline is competitor:
        pipeline.enrich_single(pg, Mock(), sp, row["isrc"])
    else:
        pipeline.enrich_single(pg, sp, row["isrc"])
    for call in pg.patch.call_args_list:
        assert "spotify_lookup_misses" not in call.args[1]
        assert "spotify_not_found_since" not in call.args[1]
    assert row["spotify_lookup_misses"] == misses
    assert row["spotify_not_found_since"] == since


def test_two_valid_empty_searches_still_count_a_batch_miss(pipeline):
    pg = Mock()
    pg.select.return_value = [{"isrc": "GBABC2600001", "spotify_lookup_misses": 1}]
    sp = pipeline.Spotify("offline", "offline")
    sp.get = Mock(return_value={"tracks": {"items": []}})
    sp.get_artists = Mock(return_value=[])
    if pipeline is competitor:
        pipeline.enrich_batch(pg, Mock(), sp, 10)
    else:
        pipeline.enrich_batch(pg, sp, 10)
    assert pg.patch.call_args.args[1]["spotify_lookup_misses"] == 2
