"""Offline regression coverage for batching, safety and workflow delivery."""

import json
from urllib.parse import parse_qs, urlsplit

import pytest

import check_spotify_track_availability as m
from test_check_spotify_track_availability import FakePg, RoutedSpotify, _args, _cands


class BatchSpotify(m.Spotify):
    def __init__(self, *, denied=None, null_slot=False):
        super().__init__("offline", "offline", min_interval_s=0)
        self.calls = []
        self.denied = denied
        self.null_slot = null_slot

    def get(self, path):
        self.calls.append(path)
        url = urlsplit(path)
        if url.path == "/tracks":
            if self.denied:
                return self.denied, None
            ids = parse_qs(url.query)["ids"][0].split(",")
            return 200, {"tracks": [None if self.null_slot and i == 0 else {"id": tid, "is_playable": True}
                                     for i, tid in enumerate(ids)]}
        if url.path.startswith("/tracks/"):
            return 200, {"id": url.path.rsplit("/", 1)[-1], "is_playable": True}
        raise AssertionError(f"Unexpected API request: {path}")


def test_3200_playable_tracks_need_64_batch_requests(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    sp = BatchSpotify()
    pg = FakePg(_cands(3200))
    assert m.run(pg, sp, _args(), m.DEFAULT_MARKETS) == 0
    assert len(sp.calls) == 64
    assert all(urlsplit(path).path == "/tracks" for path in sp.calls)
    assert len(pg.tables["spotify_track_availability"]) == 3200
    assert all(row["status"] == m.AVAILABLE for row in pg.tables["spotify_track_availability"])
    assert pg.tables["spotify_track_availability_events"] == []


@pytest.mark.parametrize("status", [403, 404])
def test_batch_denial_falls_back_once_without_false_takedowns(status):
    sp = BatchSpotify(denied=status)
    pg = FakePg(_cands(60))
    assert m.run(pg, sp, _args(dry_run=True), m.DEFAULT_MARKETS) == 0
    assert len(sp.calls) == 61
    assert sum(urlsplit(p).path == "/tracks" for p in sp.calls) == 1
    assert pg.tables["spotify_track_availability"] == []
    assert pg.tables["spotify_track_availability_events"] == []


def test_null_batch_slot_is_checked_individually():
    sp = BatchSpotify(null_slot=True)
    sp.begin_batch(["a", "b"])
    assert m.check_track(sp, "a", "QZ1234567890", ("US",)).state == m.AVAILABLE
    assert m.check_track(sp, "b", "QZ1234567891", ("US",)).state == m.AVAILABLE
    assert len(sp.calls) == 2
    assert urlsplit(sp.calls[1]).path == "/tracks/a"


def test_malformed_batch_does_not_fan_out_or_write():
    sp = BatchSpotify()
    calls = []

    def get(path):
        calls.append(path)
        return 200, {"tracks": []}

    sp.get = get
    pg = FakePg(_cands(100))
    assert m.run(pg, sp, _args(), ("US",)) == 3
    assert len(calls) == 2
    assert pg.tables["spotify_track_availability"] == []
    assert pg.tables["spotify_track_availability_events"] == []


def test_market_batches_are_lazy_and_reused():
    sp = BatchSpotify()
    calls = []

    def get(path):
        calls.append(path)
        market = parse_qs(urlsplit(path).query)["market"][0]
        return 200, {"tracks": [{"id": tid, "is_playable": market == "GB"} for tid in ["a", "b"]]}

    sp.get = get
    sp.begin_batch(["a", "b"])
    for tid in ["a", "b"]:
        assert m.check_track(sp, tid, "QZ1234567890", m.DEFAULT_MARKETS).markets_checked == ("US", "GB")
    assert len(calls) == 2
    assert [parse_qs(urlsplit(p).query)["market"][0] for p in calls] == ["US", "GB"]


@pytest.mark.parametrize("body", [{}, {"tracks": {}}, {"tracks": {"items": None}}, {"tracks": {"items": [None]}}])
def test_malformed_search_is_inconclusive(body):
    assert m.classify_search_response(200, body).state == m.UNKNOWN


def test_unknown_guard_cannot_be_bypassed_and_preserves_pending_events(monkeypatch):
    monkeypatch.setattr(m, "send_email", lambda *a: pytest.fail("Must not email"))

    class Refusing(RoutedSpotify):
        def track(self, track_id, market):
            return 403, None

    pending = {"id": 1, "isrc": "QZ0000000000", "event": "taken_down", "notified_at": None}
    pg = FakePg(_cands(100), events=[pending])
    assert m.run(pg, Refusing(()), _args(skip_safety_valve=True), ("US",)) == 3
    assert pg.tables["spotify_track_availability"] == []
    assert pg.tables["spotify_track_availability_events"] == [pending]


def test_workflow_prepares_pending_alert_then_acknowledges_only_delivered_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a: pytest.fail("Workflow must use composite action"))
    alert = tmp_path / "alert.json"
    output = tmp_path / "output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    pg = FakePg(_cands(3))
    assert m.run(pg, RoutedSpotify({"id1"}), _args(email_output=str(alert)), ("US",)) == 0
    assert pg.tables["spotify_track_availability_events"][0]["notified_at"] is None
    payload = json.loads(alert.read_text())
    assert payload["ids"] == [1]
    assert payload["subject"] == "[StreamBase] Spotify: 1 track taken down"
    assert json.loads(output.read_text().removeprefix("alert=")) == payload
    # A later event must remain pending when this delivery is acknowledged.
    pg.insert("spotify_track_availability_events", [{"isrc": "other", "event": "taken_down"}])
    m.acknowledge_workflow_email(pg, str(alert))
    assert pg.tables["spotify_track_availability_events"][0]["notified_at"]
    assert pg.tables["spotify_track_availability_events"][1]["notified_at"] is None


def test_retry_after_over_bound_aborts_before_writes(monkeypatch):
    class Response:
        status_code = 429
        headers = {"Retry-After": "121"}

    class Session:
        def get(self, *args, **kwargs):
            return Response()

    sp = m.Spotify("offline", "offline", min_interval_s=0, session=Session())
    monkeypatch.setattr(sp, "token", lambda: "offline")
    pg = FakePg(_cands(3))
    with pytest.raises(m.SpotifyRateLimited):
        m.run(pg, sp, _args(), ("US",))
    assert pg.tables["spotify_track_availability"] == []
    assert pg.tables["spotify_track_availability_events"] == []
