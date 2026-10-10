"""Offline tests for complete candidate fetching and catalog-count protection."""

import json
from urllib.parse import parse_qs, urlsplit

import pytest

import check_spotify_track_availability as m
from streambase_postgrest import Postgrest
from test_check_spotify_track_availability import FakePg, RoutedSpotify, _args, _cands


class Response:
    def __init__(self, rows, status=200):
        self.rows = rows
        self.status_code = status
        self.text = "offline response"

    def json(self):
        return self.rows


def mock_capped_db(monkeypatch, candidates, *, cap=1000, previous=()):
    offsets = []

    def request(method, url, headers, data=None, timeout=None):
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        offset = int(query["offset"][0])
        limit = min(int(query["limit"][0]), cap)
        assert query["order"] == ["isrc.asc"]
        if parsed.path == "/rest/v1/rpc/spotify_availability_candidates":
            assert method == "POST"
            assert json.loads(data) == {"p_lookback_days": 30}
            offsets.append(offset)
            return Response(candidates[offset : offset + limit])
        assert parsed.path == "/rest/v1/spotify_track_availability"
        assert method == "GET"
        return Response(list(previous)[offset : offset + limit])

    monkeypatch.setattr("streambase_postgrest.requests.request", request)
    return Postgrest("https://offline.invalid", "offline"), offsets


@pytest.mark.parametrize("total,cap", [(3180, 1000), (3000, 1000), (0, 1000), (3180, 250)])
def test_rpc_all_fetches_beyond_1000_row_cap(monkeypatch, total, cap):
    candidates = _cands(total)
    pg, offsets = mock_capped_db(monkeypatch, candidates, cap=cap)
    assert pg.rpc_all("spotify_availability_candidates", {"p_lookback_days": 30}, order="isrc.asc") == candidates
    assert offsets == list(range(0, total, cap)) + [total]


def test_run_checks_all_3180_candidates_with_1000_row_cap(monkeypatch, capsys):
    candidates = _cands(3180)
    pg, offsets = mock_capped_db(monkeypatch, candidates)
    checked = []

    class Spotify(RoutedSpotify):
        def track(self, track_id, market):
            checked.append(track_id)
            return super().track(track_id, market)

    assert m.run(pg, Spotify(()), _args(dry_run=True), ("US",)) == 0
    assert offsets == [0, 1000, 2000, 3000, 3180]
    assert checked == [row["spotify_track_id"] for row in candidates]
    assert "Candidates: 3180 catalog tracks" in capsys.readouterr().out


@pytest.mark.parametrize("count,dry_run", [(1000, False), (1000, True), (0, False)])
def test_run_refuses_suspicious_candidate_drop(monkeypatch, tmp_path, capsys, count, dry_run):
    previous = [dict(row, status=m.AVAILABLE) for row in _cands(3180)]
    pending = {"id": 1, "isrc": previous[0]["isrc"], "event": "taken_down", "notified_at": None}
    pg = FakePg(_cands(count), states=previous, events=[pending])

    def forbidden(*args, **kwargs):
        pytest.fail("Candidate count guard must run before Spotify calls, writes, or emails")

    class NoSpotify:
        track = forbidden
        search_isrc = forbidden

    for method in ["insert", "upsert", "patch"]:
        monkeypatch.setattr(pg, method, forbidden)
    monkeypatch.setattr(m, "send_email", forbidden)
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    assert m.run(pg, NoSpotify(), _args(dry_run=dry_run, skip_safety_valve=True), ("US",)) == 4
    message = f"only {count} candidates against 3180 previously checked tracks"
    assert message in capsys.readouterr().out
    assert message in summary.read_text()
    assert pg.tables["spotify_track_availability"] == previous
    assert pg.tables["spotify_track_availability_events"] == [pending]


def test_count_guard_compares_full_candidates_before_limit():
    previous = [dict(row, status=m.AVAILABLE) for row in _cands(10)]
    pg = FakePg(_cands(10), states=previous)
    assert m.run(pg, RoutedSpotify(()), _args(dry_run=True, limit=1), ("US",)) == 0


def test_count_guard_accepts_exactly_half():
    previous = [dict(row, status=m.AVAILABLE) for row in _cands(10)]
    pg = FakePg(_cands(5), states=previous)
    assert m.run(pg, RoutedSpotify(()), _args(dry_run=True), ("US",)) == 0


@pytest.mark.parametrize("status,body", [(500, []), (200, {}), (200, [None])])
def test_rpc_all_later_page_failure_is_not_partial_success(monkeypatch, status, body):
    calls = []

    def request(method, url, headers, data=None, idempotent=True):
        calls.append(url)
        return Response(_cands(1000)) if len(calls) == 1 else Response(body, status)

    pg = Postgrest("https://offline.invalid", "offline")
    monkeypatch.setattr(pg, "_request", request)
    with pytest.raises(RuntimeError, match="offset 1000"):
        pg.rpc_all("spotify_availability_candidates", {"p_lookback_days": 30}, order="isrc.asc")
