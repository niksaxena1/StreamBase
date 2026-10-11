from datetime import date, timedelta

import pytest

import check_spotify_track_availability as m
from check_spotify_track_availability import AVAILABLE, UNAVAILABLE, UNKNOWN, Verdict


class FakeSpotify:
    """Returns canned responses keyed by market; records calls."""

    def __init__(self, track_responses, search_response=(200, {"tracks": {"items": []}})):
        self.track_responses = track_responses
        self.search_response = search_response
        self.calls = []

    def track(self, track_id, market):
        self.calls.append(("track", market))
        return self.track_responses[market]

    def search_isrc(self, isrc, market):
        self.calls.append(("search", market))
        return self.search_response


TID = "3SkuTkIkeNa9l2UCexClYh"


def test_classify_404_is_not_found():
    assert m.classify_track_response(404, {"error": {}}, TID) == Verdict(UNAVAILABLE, "not_found")


def test_classify_playable_and_relinked():
    assert m.classify_track_response(200, {"id": TID, "is_playable": True}, TID).state == AVAILABLE
    v = m.classify_track_response(200, {"id": "other", "is_playable": True}, TID)
    assert v == Verdict(AVAILABLE, "relinked:other")


def test_classify_not_playable_reasons():
    v = m.classify_track_response(200, {"id": TID, "is_playable": False, "restrictions": {"reason": "market"}}, TID)
    assert v == Verdict(UNAVAILABLE, "not_playable:market")
    assert m.classify_track_response(200, {"id": TID, "is_playable": False}, TID).reason == "not_playable"
    # Listener-side restrictions are not takedowns.
    v = m.classify_track_response(200, {"id": TID, "is_playable": False, "restrictions": {"reason": "explicit"}}, TID)
    assert v.state == AVAILABLE


def test_classify_without_playability_signal():
    assert m.classify_track_response(200, {"id": TID, "available_markets": []}, TID).state == UNAVAILABLE
    assert m.classify_track_response(200, {"id": TID}, TID).state == UNKNOWN
    assert m.classify_track_response(403, None, TID) == Verdict(UNKNOWN, "http_403")


def test_check_track_stops_at_first_playable_market():
    sp = FakeSpotify({"US": (200, {"id": TID, "is_playable": True})})
    v = m.check_track(sp, TID, "QZ1234567890", ["US", "GB", "AE"])
    assert v.state == AVAILABLE
    assert sp.calls == [("track", "US")]


def test_check_track_geo_restricted_in_one_market_is_available():
    sp = FakeSpotify(
        {
            "US": (200, {"id": TID, "is_playable": False, "restrictions": {"reason": "market"}}),
            "GB": (200, {"id": TID, "is_playable": True}),
        }
    )
    assert m.check_track(sp, TID, "QZ1234567890", ["US", "GB", "AE"]).state == AVAILABLE


def test_check_track_unplayable_everywhere_confirmed_by_search_miss():
    dead = (200, {"id": TID, "is_playable": False, "restrictions": {"reason": "market"}})
    sp = FakeSpotify({"US": dead, "GB": dead, "AE": dead})
    v = m.check_track(sp, TID, "QZ1234567890", ["US", "GB", "AE"])
    assert v == Verdict(UNAVAILABLE, "not_playable:market", ("US", "GB", "AE"))
    assert sp.calls[-1] == ("search", "US")


def test_check_track_404_skips_other_markets():
    sp = FakeSpotify({"US": (404, None)})
    v = m.check_track(sp, TID, "QZ1234567890", ["US", "GB"])
    assert v.state == UNAVAILABLE and v.reason == "not_found"
    assert sp.calls == [("track", "US"), ("search", "US")]


def test_check_track_redelivered_under_new_id_is_not_a_takedown():
    sp = FakeSpotify(
        {"US": (404, None)},
        search_response=(200, {"tracks": {"items": [{"id": "newid", "is_playable": True}]}}),
    )
    assert m.check_track(sp, TID, "QZ1234567890", ["US"]) == Verdict(AVAILABLE, "relinked:newid", ("US",))


def test_check_track_no_signal_falls_back_to_search():
    sp = FakeSpotify({"US": (200, {"id": TID}), "GB": (200, {"id": TID})})
    assert m.check_track(sp, TID, "QZ1234567890", ["US", "GB"]).reason == "isrc_search_miss"

    sp = FakeSpotify(
        {"US": (200, {"id": TID})},
        search_response=(200, {"tracks": {"items": [{"id": TID, "is_playable": True}]}}),
    )
    assert m.check_track(sp, TID, "QZ1234567890", ["US"]).state == AVAILABLE


def test_check_track_no_signal_does_not_repeat_per_market():
    sp = FakeSpotify({"US": (200, {"id": TID})})
    m.check_track(sp, TID, "QZ1234567890", ["US", "GB", "AE"])
    assert sp.calls == [("track", "US"), ("search", "US")]


def test_hyphenated_isrc_is_normalized_for_search():
    seen = []

    class Sp(FakeSpotify):
        def search_isrc(self, isrc, market):
            seen.append(isrc)
            return super().search_isrc(isrc, market)

    m.check_track(Sp({"US": (404, None)}), TID, "gb-smu-30-65473", ["US"])
    assert seen == ["GBSMU3065473"]


def test_check_track_api_error_is_unknown():
    sp = FakeSpotify({"US": (500, None)})
    assert m.check_track(sp, TID, "QZ1234567890", ["US", "GB"]).state == UNKNOWN
    sp = FakeSpotify({"US": (404, None)}, search_response=(429, None))
    assert m.check_track(sp, TID, "QZ1234567890", ["US"]).state == UNKNOWN


CAND = {"isrc": "QZ1234567890", "spotify_track_id": TID}
NOW = "2026-09-25T06:00:00+00:00"
EARLIER = "2026-09-20T06:00:00+00:00"


def test_next_state_first_sighting():
    row, event = m.next_state(None, CAND, Verdict(AVAILABLE, None, ("US",)), NOW)
    assert event is None
    assert row["status"] == AVAILABLE and row["last_available_at"] == NOW and row["unavailable_since"] is None

    row, event = m.next_state(None, CAND, Verdict(UNAVAILABLE, "not_found", ("US",)), NOW)
    assert event == "taken_down" and row["unavailable_since"] == NOW


def test_next_state_transitions_and_steady_state():
    prev_ok = {
        "status": AVAILABLE,
        "first_checked_at": EARLIER,
        "status_changed_at": EARLIER,
        "last_available_at": EARLIER,
        "unavailable_since": None,
    }
    row, event = m.next_state(prev_ok, CAND, Verdict(UNAVAILABLE, "not_found"), NOW)
    assert event == "taken_down"
    assert row["first_checked_at"] == EARLIER and row["status_changed_at"] == NOW
    assert row["last_available_at"] == EARLIER and row["unavailable_since"] == NOW

    prev_down = dict(row)
    row, event = m.next_state(prev_down, CAND, Verdict(UNAVAILABLE, "not_found"), "2026-09-26T06:00:00+00:00")
    assert event is None and row["unavailable_since"] == NOW and row["status_changed_at"] == NOW

    row, event = m.next_state(prev_down, CAND, Verdict(AVAILABLE), "2026-09-27T06:00:00+00:00")
    assert event == "restored" and row["unavailable_since"] is None


def test_safety_valve():
    assert m.is_suspicious_mass_takedown(30, 200, min_count=25, max_share=0.10)
    assert not m.is_suspicious_mass_takedown(3, 20, min_count=25, max_share=0.10)
    assert not m.is_suspicious_mass_takedown(30, 1000, min_count=25, max_share=0.10)


def test_build_email_lists_takedowns_and_restores():
    events = [
        {"isrc": "QZ1234567890", "spotify_track_id": TID, "event": "taken_down", "reason": "not_found",
         "detected_at": NOW},
        {"isrc": "QZ0000000001", "spotify_track_id": "abc", "event": "restored", "reason": None, "detected_at": NOW},
    ]
    tracks = {
        "QZ1234567890": {"name": "Where I Stand", "artist_names": ["Karod"], "streams_cumulative": 123456,
                         "last_catalog_date": "2026-09-22"},
    }
    subject, text, markup = m.build_email(events, tracks)
    assert subject == "[StreamBase] Spotify: 1 track taken down, 1 restored"
    assert "Karod – Where I Stand" in text and f"https://open.spotify.com/track/{TID}" in text
    assert "123,456" in text and "QZ0000000001" in text
    assert "<strong>Where I Stand</strong>" in markup


def test_parse_markets():
    assert m.parse_markets(None) == m.DEFAULT_MARKETS
    assert m.parse_markets(" us, gb ,") == ("US", "GB")


class FakePg:
    def __init__(self, candidates, states=(), events=(), daily_streams=None):
        self.candidates = candidates
        if daily_streams is None:
            daily_streams = [
                {"isrc": c["isrc"], "date": c["last_catalog_date"],
                 "streams_cumulative": c.get("streams_cumulative")}
                for c in candidates if c.get("spotify_track_id")
            ]
        self.tables = {
            "spotify_track_availability": list(states),
            "spotify_track_availability_events": list(events),
            "tracks": [],
            "track_daily_streams_effective": list(daily_streams),
        }
        self.next_id = 1 + len(events)
        self.effective_queries = []

    def rpc(self, name, params):
        assert name == "spotify_availability_candidates"
        return self.candidates

    def rpc_all(self, name, params, *, order, page_size=1000):
        assert order == "isrc.asc"
        return self.rpc(name, params)

    def select_all(self, table, select, filters, order=None, page_size=1000):
        if table == "track_daily_streams_effective":
            self.effective_queries.append((select, filters, order))
            requested_isrcs = set(filters.split("isrc=in.(", 1)[1].split(")", 1)[0].split(","))
            return [dict(r) for r in self.tables[table] if r["isrc"] in requested_isrcs]
        rows = self.tables[table]
        if filters == "notified_at=is.null":
            rows = [r for r in rows if r.get("notified_at") is None]
        return [dict(r) for r in rows]

    def insert(self, table, rows):
        for r in rows:
            r = dict(r, id=self.next_id)
            r.setdefault("detected_at", NOW)
            r.setdefault("notified_at", None)
            self.next_id += 1
            self.tables[table].append(r)
        return rows

    def upsert(self, table, rows, on_conflict):
        by_key = {r[on_conflict]: r for r in self.tables[table]}
        for r in rows:
            by_key[r[on_conflict]] = dict(r)
        self.tables[table] = list(by_key.values())

    def patch(self, table, patch_obj, filters):
        ids = {int(x) for x in filters.split("(")[1].rstrip(")").split(",")}
        for r in self.tables[table]:
            if r.get("id") in ids:
                r.update(patch_obj)


def _args(**kw):
    import argparse

    base = dict(lookback_days=30, limit=0, dry_run=False, skip_safety_valve=False,
                mass_min_count=25, mass_max_share=0.10)
    base.update(kw)
    return argparse.Namespace(**base)


class RoutedSpotify:
    """Per-track-id responses for run() tests."""

    def __init__(self, dead_ids):
        self.dead_ids = set(dead_ids)

    def track(self, track_id, market):
        return (404, None) if track_id in self.dead_ids else (200, {"id": track_id, "is_playable": True})

    def search_isrc(self, isrc, market):
        return (200, {"tracks": {"items": []}})


def _cands(n):
    return [{"isrc": f"QZ{i:010d}", "name": f"Song {i}", "spotify_track_id": f"id{i}",
             "artist_names": ["A"], "streams_cumulative": 10, "last_catalog_date": "2026-09-22"} for i in range(n)]


def test_run_records_and_emails_once(monkeypatch):
    sent = []
    monkeypatch.setattr(m, "send_email", lambda *a: sent.append(a))
    cands = _cands(5) + [{"isrc": "QZNOID000000", "name": "x", "spotify_track_id": None}]
    pg = FakePg(cands)
    assert m.run(pg, RoutedSpotify({"id2"}), _args(), ("US",)) == 0
    states = {r["isrc"]: r["status"] for r in pg.tables["spotify_track_availability"]}
    assert states["QZ0000000002"] == UNAVAILABLE and list(states.values()).count(AVAILABLE) == 4
    assert len(sent) == 1 and "1 track taken down" in sent[0][1]
    assert all(e["notified_at"] for e in pg.tables["spotify_track_availability_events"])

    # Same state next day: no new event, no email.
    assert m.run(pg, RoutedSpotify({"id2"}), _args(), ("US",)) == 0
    assert len(sent) == 1 and len(pg.tables["spotify_track_availability_events"]) == 1

    # Restored.
    assert m.run(pg, RoutedSpotify(set()), _args(), ("US",)) == 0
    assert len(sent) == 2 and "1 restored" in sent[1][1]


def test_run_retries_unsent_alerts(monkeypatch):
    def boom(*a):
        raise RuntimeError("smtp down")

    pg = FakePg(_cands(3))
    monkeypatch.setattr(m, "send_email", boom)
    try:
        m.run(pg, RoutedSpotify({"id1"}), _args(), ("US",))
    except RuntimeError:
        pass
    sent = []
    monkeypatch.setattr(m, "send_email", lambda *a: sent.append(a))
    assert m.run(pg, RoutedSpotify({"id1"}), _args(), ("US",)) == 0
    assert len(sent) == 1 and len(pg.tables["spotify_track_availability_events"]) == 1


def test_run_safety_valves(monkeypatch):
    monkeypatch.setattr(m, "send_email", lambda *a: (_ for _ in ()).throw(AssertionError("no email")))
    cands = _cands(100)
    pg = FakePg(cands)
    dead = {f"id{i}" for i in range(40)}
    assert m.run(pg, RoutedSpotify(dead), _args(), ("US",)) == 2
    assert pg.tables["spotify_track_availability"] == []

    class Refusing(RoutedSpotify):
        def track(self, track_id, market):
            return (403, None)

    assert m.run(pg, Refusing(()), _args(), ("US",)) == 3
    assert pg.tables["spotify_track_availability"] == []


def test_run_dry_run_writes_nothing(monkeypatch):
    monkeypatch.setattr(m, "send_email", lambda *a: (_ for _ in ()).throw(AssertionError("no email")))
    pg = FakePg(_cands(3))
    assert m.run(pg, RoutedSpotify({"id0"}), _args(dry_run=True), ("US",)) == 0
    assert pg.tables["spotify_track_availability"] == []


def _daily_rows(isrc, values):
    end = date.fromisoformat("2026-09-22")
    dates = [end - timedelta(days=len(values) - i - 1) for i in range(len(values))]
    return [{"isrc": isrc, "date": d.isoformat(), "streams_cumulative": value}
            for d, value in zip(dates, values)]


@pytest.mark.parametrize(
    ("values", "expected_reason", "should_email"),
    [
        ([0], "already_zero_total", False),
        ([None], "already_zero_total", False),
        ([20] * 7, "no_daily_streams_7d", False),
        ([14, 15, 16, 17, 18, 19, 20], None, True),
        ([15] * 6, None, True),
    ],
    ids=["already-zero", "already-null", "flat-seven-days", "growing", "fewer-than-seven-dates"],
)
def test_run_suppresses_only_already_dead_takedowns(monkeypatch, values, expected_reason, should_email):
    sent = []
    monkeypatch.setattr(m, "send_email", lambda *args: sent.append(args))
    candidates = _cands(1)
    daily_rows = _daily_rows(candidates[0]["isrc"], values)
    pg = FakePg(candidates, daily_streams=daily_rows)

    assert m.run(pg, RoutedSpotify({"id0"}), _args(), ("US",)) == 0

    event = pg.tables["spotify_track_availability_events"][0]
    if expected_reason:
        assert event["notified_at"]
        assert event["suppressed_reason"] == expected_reason
        assert sent == []
    else:
        assert event.get("notified_at")
        assert event.get("suppressed_reason") is None
        assert len(sent) == 1
    assert len(pg.effective_queries) == 1
    assert "isrc=in.(QZ0000000000)" in pg.effective_queries[0][1]


def test_run_restoration_is_always_emailed(monkeypatch):
    sent = []
    monkeypatch.setattr(m, "send_email", lambda *args: sent.append(args))
    candidates = _cands(1)
    previous = [{"isrc": candidates[0]["isrc"], "status": UNAVAILABLE}]
    flat_rows = _daily_rows(candidates[0]["isrc"], [20] * 7)
    pg = FakePg(candidates, states=previous, daily_streams=flat_rows)

    assert m.run(pg, RoutedSpotify(set()), _args(), ("US",)) == 0

    event = pg.tables["spotify_track_availability_events"][0]
    assert event["event"] == "restored"
    assert event.get("notified_at")
    assert event.get("suppressed_reason") is None
    assert len(sent) == 1 and "1 restored" in sent[0][1]
    assert pg.effective_queries == []


def test_safety_valve_counts_suppressed_takedowns(monkeypatch):
    monkeypatch.setattr(m, "send_email", lambda *args: (_ for _ in ()).throw(AssertionError("no email")))
    candidates = _cands(100)
    flat = [row for c in candidates for row in _daily_rows(c["isrc"], [20] * 7)]
    pg = FakePg(candidates, daily_streams=flat)

    assert m.run(pg, RoutedSpotify({f"id{i}" for i in range(40)}), _args(), ("US",)) == 2
    assert pg.tables["spotify_track_availability_events"] == []
    assert pg.effective_queries == []
