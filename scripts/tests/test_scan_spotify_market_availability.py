import argparse

import pytest

import scan_spotify_market_availability as m

TID = "3SkuTkIkeNa9l2UCexClYh"


def playable(tid=TID, **extra):
    return {"id": tid, "is_playable": True, **extra}


def blocked(reason="market", tid=TID):
    body = {"id": tid, "is_playable": False}
    if reason is not None:
        body["restrictions"] = {"reason": reason}
    return body


def cand(isrc="QZ0000000001", tid=TID, name="Song", artists=("Saxena",)):
    return {"isrc": isrc, "spotify_track_id": tid, "name": name, "artist_names": list(artists)}


class FakeSpotify:
    """market -> {track_id: entry}; unknown ids are playable. Records requests."""

    def __init__(self, by_market=None, errors=()):
        self.by_market = by_market or {}
        self.errors = set(errors)
        self.calls = []

    def market_entries(self, ids, market):
        self.calls.append((tuple(ids), market))
        if market in self.errors:
            return [(m.ENTRY_ERROR, None) for _ in ids]
        table = self.by_market.get(market, {})
        return [(m.ENTRY_OK, table[i] if i in table else playable(i)) for i in ids]


# --- classification -------------------------------------------------------

def test_classify_playable_relinked_restricted_and_null():
    assert m.classify_entry(playable(), TID) == (True, None, False)
    assert m.classify_entry(playable(linked_from={"id": TID}, id="other"), TID) == (True, None, True)
    assert m.classify_entry(playable(tid="other"), TID) == (True, None, True)
    assert m.classify_entry(blocked("market"), TID) == (False, "market", False)
    assert m.classify_entry(blocked(None), TID) == (False, "none", False)
    assert m.classify_entry(None, TID) == (False, "missing", False)
    assert m.classify_entry({"error": {"status": 400}}, TID) == (False, "missing", False)


def test_universe_excludes_xk_and_requires_150():
    markets = sorted({f"{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(190)})
    assert "XK" not in m.build_universe(markets + ["XK"])
    assert len(m.build_universe(markets + ["XK"])) == len(markets) - (1 if "XK" in markets else 0)
    with pytest.raises(SystemExit):
        m.build_universe(markets[:100])
    with pytest.raises(SystemExit):
        m.build_universe(None)


def test_scan_markets_collects_unavailable_and_relinked():
    sp = FakeSpotify({"BR": {TID: blocked("market")}, "CA": {TID: playable(linked_from={"id": "x"})}})
    res = m.scan_markets(sp, [cand()], ["BR", "CA", "US"], log=lambda *_: None)
    r = res["QZ0000000001"]
    assert r["unavailable"] == {"BR": "market"}
    assert r["checked"] == 3 and r["relinked"] is True and r["errored"] == []


def test_scan_markets_batches_fifty_tracks_per_request():
    tracks = [cand(isrc=f"QZ{i:010d}", tid=f"t{i}") for i in range(120)]
    sp = FakeSpotify()
    m.scan_markets(sp, tracks, ["US", "GB"], log=lambda *_: None)
    sizes = [len(ids) for ids, _ in sp.calls]
    assert sizes == [50, 50, 20, 50, 50, 20]


def test_scan_markets_errors_are_not_unavailable():
    res = m.scan_markets(FakeSpotify(errors={"BR"}), [cand()], ["BR", "US"], log=lambda *_: None)["QZ0000000001"]
    assert res["errored"] == ["BR"] and res["unavailable"] == {} and res["checked"] == 1


# --- diffing / rows ---------------------------------------------------------

def scan(unavailable=None, errored=(), checked=183, relinked=False):
    return {"unavailable": dict(unavailable or {}), "errored": list(errored), "checked": checked, "relinked": relinked}


def prev_row(markets, reasons=None):
    return {
        "unavailable_markets": list(markets),
        "unavailable_reasons": reasons or {k: "market" for k in markets},
        "first_checked_at": "2026-01-01T00:00:00+00:00",
        "markets_changed_at": "2026-02-01T00:00:00+00:00",
    }


def test_diff_lost_and_gained():
    events = m.diff_events(prev_row(["BR", "IN"]), {"IN": "market", "MX": "none"})
    assert events == [
        {"market": "MX", "event": "lost", "reason": "none"},
        {"market": "BR", "event": "gained", "reason": None},
    ]


def test_first_scan_seeds_silently():
    assert m.diff_events(None, {"BR": "market", "IN": "market"}) == []
    row = m.build_row(cand(), scan({"BR": "market"}), None, 183, "NOW")
    assert row["first_checked_at"] == "NOW" and row["markets_changed_at"] == "NOW"
    assert row["available_count"] == 182 and row["unavailable_markets"] == ["BR"]
    assert row["unavailable_reasons"] == {"BR": "market"}


def test_markets_changed_at_only_when_set_changes():
    same = m.build_row(cand(), scan({"BR": "market", "IN": "market"}), prev_row(["BR", "IN"]), 183, "NOW")
    assert same["markets_changed_at"] == "2026-02-01T00:00:00+00:00"
    assert same["first_checked_at"] == "2026-01-01T00:00:00+00:00"
    changed = m.build_row(cand(), scan({"BR": "market"}), prev_row(["BR", "IN"]), 183, "NOW")
    assert changed["markets_changed_at"] == "NOW"


def test_errored_market_inherits_previous_state():
    prev = prev_row(["BR"], {"BR": "market"})
    s = scan({}, errored=["BR"])
    assert m.effective_unavailable(prev, s) == {"BR": "market"}
    assert m.diff_events(prev, m.effective_unavailable(prev, s), s["errored"]) == []


# --- safety valve -----------------------------------------------------------

def test_valve_trips_on_missing_share():
    results = {f"I{i}": scan({"US": "missing"} if i < 30 else {}, checked=1) for i in range(100)}
    code, msg = m.safety_valve_reason(results, {})
    assert code == m.EXIT_MISSING_VALVE and "missing or errored" in msg


def test_valve_passes_on_normal_scan():
    results = {"I1": scan({"BR": "market", "IN": "market"}, checked=183), "I2": scan({}, checked=183)}
    assert m.safety_valve_reason(results, {}) is None


def test_valve_trips_when_many_tracks_lose_ten_markets():
    lost = {f"M{i}": "market" for i in range(10)}
    results = {f"I{i}": scan(lost if i < 3 else {}) for i in range(10)}
    prev = {f"I{i}": prev_row([]) for i in range(10)}
    code, _ = m.safety_valve_reason(results, prev)
    assert code == m.EXIT_MASS_LOSS_VALVE
    # first scan (no previous rows) is never a mass loss
    assert m.safety_valve_reason(results, {}) is None


def test_valve_ignores_few_big_losses():
    lost = {f"M{i}": "market" for i in range(12)}
    results = {f"I{i}": scan(lost if i == 0 else {}) for i in range(50)}
    prev = {f"I{i}": prev_row([]) for i in range(50)}
    assert m.safety_valve_reason(results, prev) is None


# --- filters / report / email ----------------------------------------------

def test_artist_filter_case_insensitive_and_isrc():
    cs = [
        cand("QZ1", "a", "One", ("Saxena",)),
        cand("QZ2", "b", "Two", ("Other", "SAXENA")),
        cand("QZ3", "c", "Three", ("Someone",)),
        {"isrc": "QZ4", "spotify_track_id": None, "name": "NoId", "artist_names": ["Saxena"]},
    ]
    assert [c["isrc"] for c in m.filter_candidates(cs, artist="saxena")] == ["QZ1", "QZ2"]
    assert [c["isrc"] for c in m.filter_candidates(cs, isrcs=["qz-3"])] == ["QZ3"]
    assert [c["isrc"] for c in m.filter_candidates(cs, limit=2)] == ["QZ1", "QZ2"]


def test_report_csv_shows_artist_names(tmp_path):
    row = m.build_row(cand(artists=("A", "B")), scan({"BR": "market", "IN": "none"}), None, 183, "NOW")
    path = tmp_path / "r.csv"
    m.write_report_csv(str(path), [(cand(artists=("A", "B")), row)])
    text = path.read_text(encoding="utf-8")
    assert '"A, B"' in text and "181 / 183" in text and "BR=market; IN=none" in text


def test_email_only_lists_lost_events():
    events = [
        {"id": 1, "isrc": "QZ1", "market": "IN", "event": "lost"},
        {"id": 2, "isrc": "QZ1", "market": "BR", "event": "lost"},
        {"id": 3, "isrc": "QZ1", "market": "MX", "event": "gained"},
    ]
    subject, text, _ = m.build_email(events, {"QZ1": {"name": "Song", "artist_names": ["A", "B"]}})
    assert "1 track lost" in subject
    assert "A, B – Song (QZ1): newly unavailable in BR, IN" in text
    assert "MX" not in text


# --- end to end with a fake DB ---------------------------------------------

class FakePg:
    def __init__(self, candidates, prev_rows):
        self.candidates, self.prev_rows = candidates, prev_rows
        self.inserted, self.upserted, self.patched = [], [], []

    def rpc_all(self, name, params, order):
        return self.candidates

    def select_all(self, table, select, filters, order=None):
        if table == "spotify_track_market_availability":
            return self.prev_rows
        if table == "spotify_track_market_events":
            return [{"id": 9, "isrc": "QZ0000000001", "market": "BR", "event": "lost", "reason": "market"}] \
                if "notified_at" in filters else []
        return []

    def insert(self, table, rows):
        self.inserted += rows

    def upsert(self, table, rows, on_conflict):
        self.upserted += rows

    def patch(self, table, obj, filters):
        self.patched.append((table, obj, filters))


class UniverseSpotify(FakeSpotify):
    def market_universe(self):
        return ["BR", "IN", "US"]


def args(**kw):
    base = dict(
        dry_run=False, limit=0, artist=None, isrc=None, lookback_days=30, report_csv=None,
        email_output=None, skip_safety_valve=False,
    )
    base.update(kw)
    return argparse.Namespace(**base)


def test_run_first_scan_writes_rows_without_events(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a, **k: None)
    pg = FakePg([cand()], [])
    sp = UniverseSpotify({"BR": {TID: blocked()}})
    assert m.run(pg, sp, args()) == 0
    assert pg.inserted == []
    assert pg.upserted[0]["unavailable_markets"] == ["BR"]


def test_run_second_scan_inserts_events_and_emails(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    pg = FakePg([cand()], [prev_row(["IN"]) | {"isrc": "QZ0000000001"}])
    sp = UniverseSpotify({"BR": {TID: blocked()}})
    out = tmp_path / "email.json"
    assert m.run(pg, sp, args(email_output=str(out))) == 0
    kinds = sorted((e["market"], e["event"]) for e in pg.inserted)
    assert kinds == [("BR", "lost"), ("IN", "gained")]
    assert next(e for e in pg.inserted if e["event"] == "gained")["notified_at"] is not None
    assert next(e for e in pg.inserted if e["event"] == "lost")["notified_at"] is None
    assert out.exists()


def test_run_dry_run_writes_nothing():
    pg = FakePg([cand()], [prev_row([]) | {"isrc": "QZ0000000001"}])
    assert m.run(pg, UniverseSpotify({"BR": {TID: blocked()}}), args(dry_run=True)) == 0
    assert pg.inserted == [] and pg.upserted == [] and pg.patched == []


def test_run_valve_writes_nothing():
    pg = FakePg([cand()], [])
    sp = UniverseSpotify(errors={"BR", "IN"})
    assert m.run(pg, sp, args()) == m.EXIT_MISSING_VALVE
    assert pg.upserted == [] and pg.inserted == []
