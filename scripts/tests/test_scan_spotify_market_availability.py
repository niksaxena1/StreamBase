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


UNIVERSE = ["BR", "CA", "DE", "GB", "IN", "US"]


class FakeSpotify:
    """Fake of the Spotify client's `tracks(ids, market)`; counts and records every call.

    lists: stored/copy id -> available_markets returned by the no-market list call
           (an id missing from `lists` yields a null entry).
    blocked: {(id, market)} -> not playable there ("market" restriction).
    relinks: {(id, market)} -> new id; Spotify serves another copy there.
    error_markets: markets whose calls fail.
    """

    def __init__(self, lists=None, blocked=(), relinks=None, error_markets=(), searches=None):
        self.searches = searches or {}  # isrc -> list of search items
        self.search_calls = []
        self.lists = lists or {}
        self.blocked = set(blocked)
        self.relinks = relinks or {}
        self.error_markets = set(error_markets)
        self.calls = []
        self.requests = 0

    def tracks(self, ids, market=None):
        self.requests += 1
        self.calls.append((tuple(ids), market))
        out = []
        for i in ids:
            if market in self.error_markets:
                out.append((m.ENTRY_ERROR, None))
            elif market is None:
                out.append((m.ENTRY_OK, {"id": i, "available_markets": self.lists[i]} if i in self.lists else None))
            elif (i, market) in self.relinks:
                out.append((m.ENTRY_OK, playable(self.relinks[(i, market)], linked_from={"id": i})))
            elif (i, market) in self.blocked:
                out.append((m.ENTRY_OK, blocked("market", i)))
            else:
                out.append((m.ENTRY_OK, playable(i)))
        return out

    def search_isrc(self, isrc):
        self.requests += 1
        self.search_calls.append(isrc)
        return 200, {"tracks": {"items": self.searches.get(isrc, [])}}

    def markets_called(self):
        return [mk for _, mk in self.calls]


def scan_catalog(sp, tracks, universe=UNIVERSE, **kw):
    return m.scan_catalog(sp, tracks, universe, log=lambda *_: None, **kw)



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


# --- A. list pass + C. verify ----------------------------------------------

def test_list_pass_then_verify_only_markets_outside_list():
    sp = FakeSpotify(lists={TID: ["CA", "DE", "GB", "IN", "US"]}, blocked={(TID, "BR")})
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert res["unavailable"] == {"BR": "market"}
    assert sp.markets_called() == [None, "BR"]  # one list call, one verify call
    assert res["unverified"] == [] and res["errored"] == []


def test_verify_marks_playable_copy_as_available():
    sp = FakeSpotify(lists={TID: ["US"]}, relinks={(TID, "BR"): "copy"})
    res = scan_catalog(sp, [cand()], universe=["BR", "US"])["QZ0000000001"]
    assert res["unavailable"] == {} and res["relinked"] is True


def test_list_pass_batches_fifty_ids():
    tracks = [cand(isrc=f"QZ{i:010d}", tid=f"t{i}") for i in range(120)]
    sp = FakeSpotify(lists={f"t{i}": UNIVERSE for i in range(120)})
    scan_catalog(sp, tracks)
    assert [len(ids) for ids, _ in sp.calls] == [50, 50, 20]


def test_verify_groups_tracks_by_market():
    tracks = [cand(isrc=f"QZ{i:010d}", tid=f"t{i}") for i in range(60)]
    lists = {f"t{i}": [x for x in UNIVERSE if x not in ("BR",) + (("CA",) if i == 0 else ())] for i in range(60)}
    sp = FakeSpotify(lists=lists, blocked={(f"t{i}", "BR") for i in range(60)} | {("t0", "CA")})
    res = scan_catalog(sp, tracks)
    verify_calls = [(len(ids), mk) for ids, mk in sp.calls if mk]
    assert verify_calls == [(50, "BR"), (10, "BR"), (1, "CA")]  # most tracks first, 50 per request
    assert res["QZ0000000000"]["unavailable"] == {"BR": "market", "CA": "market"}
    assert res["QZ0000000001"]["unavailable"] == {"BR": "market"}


def test_verify_error_is_carried_not_unavailable():
    sp = FakeSpotify(lists={TID: ["US"]}, error_markets={"BR"})
    res = scan_catalog(sp, [cand()], universe=["BR", "US"])["QZ0000000001"]
    assert res["errored"] == ["BR"] and res["unavailable"] == {} and res["checked"] == 1


def test_list_error_marks_whole_universe_errored():
    sp = FakeSpotify(error_markets={None})
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert res["errored"] == UNIVERSE and res["checked"] == 0


# --- B. resolve pass ---------------------------------------------------------

def test_stale_id_resolved_via_us_and_unions_copy_markets():
    sp = FakeSpotify(
        lists={TID: [], "new": ["CA", "DE", "GB", "IN", "US"]},
        relinks={(TID, "US"): "new"},
        blocked={(TID, "BR")},
    )
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert sp.calls[0] == ((TID,), None) and sp.calls[1] == ((TID,), "US")
    assert (("new",), None) in sp.calls  # resolved copy's own list
    assert "GB" not in sp.markets_called()[1:2] and "DE" not in sp.markets_called()
    assert res["unavailable"] == {"BR": "market"} and res["relinked"] is True


def test_stale_id_falls_back_to_gb_then_de_for_the_remainder_only():
    tracks = [cand("QZ1", "a"), cand("QZ2", "b"), cand("QZ3", "c")]
    sp = FakeSpotify(
        lists={"a": [], "b": [], "c": [], "ra": UNIVERSE, "rb": UNIVERSE},
        relinks={("a", "US"): "ra", ("b", "DE"): "rb"},
        blocked={("b", "US"), ("b", "GB"), ("c", "US"), ("c", "GB"), ("c", "DE")},
    )
    res = scan_catalog(sp, tracks)
    probes = [(ids, mk) for ids, mk in sp.calls if mk in ("US", "GB", "DE")]
    assert probes == [(("a", "b", "c"), "US"), (("b", "c"), "GB"), (("b", "c"), "DE")]
    assert res["QZ1"]["unavailable"] == {} and res["QZ2"]["unavailable"] == {}
    assert set(res["QZ3"]["unavailable"]) == set(UNIVERSE)


def test_unresolved_track_is_not_found_everywhere_without_per_market_calls():
    sp = FakeSpotify(lists={TID: []}, blocked={(TID, "US"), (TID, "GB"), (TID, "DE")})
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert res["unavailable"] == {mk: "not_found" for mk in UNIVERSE}
    assert sp.markets_called() == [None, "US", "GB", "DE"]  # no verify calls


def test_null_list_entry_is_resolved_or_not_found():
    sp = FakeSpotify(lists={}, relinks={(TID, "US"): "new"})
    sp.lists["new"] = UNIVERSE
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert res["unavailable"] == {}


def test_probe_market_counts_as_available_in_union():
    # stale id, copy's list lacks US but the US probe proved it plays there: no verify call for US
    sp = FakeSpotify(lists={TID: [], "new": ["CA", "DE", "GB", "IN"]}, relinks={(TID, "US"): "new"}, blocked={(TID, "BR")})
    scan_catalog(sp, [cand()])
    assert "US" not in [mk for ids, mk in sp.calls[2:]]


# --- ISRC search before not_found ---------------------------------------------

def item(isrc, markets):
    return {"id": "other", "external_ids": {"isrc": isrc}, "available_markets": markets}


def stale(**kw):
    return FakeSpotify(lists={TID: []}, blocked={(TID, "US"), (TID, "GB"), (TID, "DE")}, **kw)


def test_isrc_search_union_replaces_not_found_and_verify_covers_gaps():
    sp = stale(
        searches={"QZ0000000001": [item("QZ0000000001", ["CA", "DE", "GB", "US"]), item("QZ9999999999", ["BR"])]},
    )
    sp.blocked |= {(TID, "BR")}
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert sp.search_calls == ["QZ0000000001"]
    # union ignores the non-matching ISRC's markets; BR and IN are verified (only BR is blocked)
    assert res["unavailable"] == {"BR": "market"}
    assert "BR" in sp.markets_called() and "IN" in sp.markets_called()


def test_isrc_search_without_match_is_not_found():
    sp = stale(searches={"QZ0000000001": [item("QZ9999999999", UNIVERSE)]})
    res = scan_catalog(sp, [cand()])["QZ0000000001"]
    assert res["unavailable"] == {mk: "not_found" for mk in UNIVERSE}
    assert sp.search_calls == ["QZ0000000001"]


def test_search_cap_marks_rest_unverified_and_keeps_previous_state():
    tracks = [cand(f"QZ{i}", f"t{i}") for i in range(3)]
    sp = FakeSpotify(
        lists={f"t{i}": [] for i in range(3)},
        blocked={(f"t{i}", mk) for i in range(3) for mk in ("US", "GB", "DE")},
    )
    res = scan_catalog(sp, tracks, max_search_requests=1)
    assert sp.search_calls == ["QZ0"]
    assert res["QZ0"]["unavailable"] == {mk: "not_found" for mk in UNIVERSE}
    for k in ("QZ1", "QZ2"):
        assert res[k]["unverified"] == UNIVERSE
        assert set(res[k]["unavailable"].values()) == {"unverified"}
    # previous row state is kept, no events
    prev = prev_row(["BR"])
    eff = m.effective_unavailable(prev, res["QZ1"])
    assert eff == {"BR": "market"}
    assert m.diff_events(prev, eff, m.carried_markets(res["QZ1"])) == []


# --- C. verify cap -----------------------------------------------------------

def test_verify_plan_prefers_markets_with_most_tracks():
    groups = {"BR": ["a"] * 60, "CA": ["b"], "DE": ["c", "d"]}
    assert m.verify_plan(groups, 3) == (["BR", "DE"], ["CA"])
    assert m.verify_plan(groups, 0) == ([], ["BR", "DE", "CA"])
    assert m.verify_plan(groups, 100) == (["BR", "DE", "CA"], [])


def test_verify_cap_records_rest_as_unverified():
    tracks = [cand("QZ1", "a"), cand("QZ2", "b"), cand("QZ3", "c")]
    lists = {"a": ["US", "GB", "DE"], "b": ["US", "GB", "DE", "CA", "IN"], "c": UNIVERSE}
    sp = FakeSpotify(lists=lists, blocked={("a", "BR"), ("b", "BR"), ("a", "CA"), ("a", "IN")})
    res = scan_catalog(sp, tracks, max_verify_requests=1)
    verified = [mk for _, mk in sp.calls if mk]
    assert verified == ["BR"]  # 2 tracks miss BR; CA/IN (1 track each) are left over
    assert res["QZ1"]["unavailable"] == {"BR": "market", "CA": "unverified", "IN": "unverified"}
    assert res["QZ1"]["unverified"] == ["CA", "IN"]
    assert res["QZ3"]["unavailable"] == {}


def test_unverified_markets_never_create_events_and_keep_previous_state():
    s = scan({"CA": "unverified", "BR": "market"})
    s["unverified"] = ["CA"]
    # no previous row: unverified markets make no claim (never seed false gaps), no events
    assert m.effective_unavailable(None, s) == {"BR": "market"}
    prev = prev_row(["BR"])
    eff = m.effective_unavailable(prev, s)
    assert eff == {"BR": "market"}  # CA was available before: stays available
    assert m.diff_events(prev, eff, m.carried_markets(s)) == []


# --- D. request budget -------------------------------------------------------

def test_budget_abort_raises_when_requests_exceed_cap():
    sp = FakeSpotify(lists={TID: ["US"]})
    with pytest.raises(m.RequestBudgetExceeded):
        scan_catalog(sp, [cand()], max_requests=1)  # list call + verify calls need more than 1


def test_spotify_client_counts_every_call_and_enforces_budget():
    class Resp:
        status_code = 200
        content = b"{}"
        headers = {}

        def json(self):
            return {"tracks": [{"id": "a"}]}

    class Http:
        def get(self, *a, **k):
            return Resp()

    sp = m.Spotify("id", "secret", min_interval_s=0, max_requests=2, session=Http())
    sp._token, sp._expires_at = "tok", 9e12
    sp.tracks(["a"])
    sp.tracks(["a"])
    assert sp.requests == 2
    with pytest.raises(m.RequestBudgetExceeded):
        sp.tracks(["a"])



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


def test_email_has_lost_and_regained_sections_in_one_email():
    events = [
        {"id": 1, "isrc": "QZ1", "market": "IN", "event": "lost"},
        {"id": 2, "isrc": "QZ1", "market": "BR", "event": "lost"},
        {"id": 3, "isrc": "QZ2", "market": "CA", "event": "gained"},
        {"id": 4, "isrc": "QZ3", "market": "MX", "event": "lost"},
    ]
    tracks = {
        "QZ1": {"name": "Song", "artist_names": ["A", "B"]},
        "QZ2": {"name": "Other", "artist_names": ["C"]},
        "QZ3": {"name": "Third", "artist_names": ["D"]},
    }
    subject, text, html_body = m.build_email(events, tracks)
    assert subject == "[StreamBase] Territories: 2 tracks lost, 1 regained availability"
    assert "Lost\n- A, B – Song (QZ1): lost BR, IN" in text
    assert "Regained\n- C – Other (QZ2): regained CA" in text
    assert text.index("Lost") < text.index("Regained")
    assert "<h3>Lost</h3>" in html_body and "<h3>Regained</h3>" in html_body


def test_email_with_only_regained_events():
    subject, text, _ = m.build_email(
        [{"id": 1, "isrc": "QZ1", "market": "CA", "event": "gained"}],
        {"QZ1": {"name": "Song", "artist_names": ["A"]}},
    )
    assert subject == "[StreamBase] Territories: 1 regained availability"
    assert "Lost" not in text and "A – Song (QZ1): regained CA" in text


# --- new tracks (release-day rule) -------------------------------------------

def test_new_track_first_scan_records_lost_events_but_old_track_seeds_silently():
    unavailable = {"BR": "market", "IN": "none"}
    assert m.diff_events(None, unavailable, is_new=True) == [
        {"market": "BR", "event": "lost", "reason": "market"},
        {"market": "IN", "event": "lost", "reason": "none"},
    ]
    assert m.diff_events(None, unavailable, is_new=False) == []
    assert m.diff_events(None, unavailable, errored=["IN"], is_new=True) == [
        {"market": "BR", "event": "lost", "reason": "market"}
    ]
    assert m.diff_events(None, {}, is_new=True) == []


def test_new_track_isrcs_needs_no_row_and_recent_tracks_row():
    todo = [cand("QZ1"), cand("QZ2"), cand("QZ3")]
    prev = {"QZ2": prev_row([])}
    assert m.new_track_isrcs(todo, prev, ["qz1", "QZ2"]) == {"QZ1"}  # QZ2 has a row, QZ3 is old


def test_bulk_import_of_new_tracks_is_seeded_silently():
    todo = [cand(f"QZ{i:04d}") for i in range(m.MAX_NEW_TRACK_ALERTS + 1)]
    assert m.new_track_isrcs(todo, {}, [c["isrc"] for c in todo]) == set()


def test_is_uncertain_flags_errored_unverified_and_not_found():
    ok = {"unavailable": {"BR": "market"}, "errored": [], "unverified": []}
    assert not m.is_uncertain(ok)
    assert m.is_uncertain({**ok, "errored": ["IN"]})
    assert m.is_uncertain({**ok, "unverified": ["IN"]})
    assert m.is_uncertain({"unavailable": {"BR": "not_found"}, "errored": [], "unverified": []})

# --- end to end with a fake DB ---------------------------------------------

class FakePg:
    def __init__(self, candidates, prev_rows):
        self.candidates, self.prev_rows = candidates, prev_rows
        self.inserted, self.upserted, self.patched = [], [], []

    def rpc_all(self, name, params, order):
        return self.candidates

    taken_down = ()
    recent_tracks = ()

    def select_all(self, table, select, filters, order=None):
        if table == "tracks" and "created_at=gte" in filters:
            return [{"isrc": i} for i in self.recent_tracks]
        if table == "spotify_track_availability":
            assert filters == "status=eq.unavailable"
            return [{"isrc": i} for i in self.taken_down]
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


def args(**kw):
    base = dict(
        dry_run=False, limit=0, artist=None, isrc=None, lookback_days=30, report_csv=None,
        email_output=None, skip_safety_valve=False, new_only=False,
        max_requests=1000, max_verify_requests=400, max_search_requests=150,
    )
    base.update(kw)
    return argparse.Namespace(**base)


class UniverseSpotify(FakeSpotify):
    def market_universe(self):
        return ["BR", "IN", "US"]

    @property
    def requests_used(self):
        return self.requests


def test_run_first_scan_writes_rows_without_events(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a, **k: None)
    pg = FakePg([cand()], [])
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    assert m.run(pg, sp, args()) == 0
    assert pg.inserted == []
    assert pg.upserted[0]["unavailable_markets"] == ["BR"]


def test_run_second_scan_inserts_events_and_emails(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    pg = FakePg([cand()], [prev_row(["IN"]) | {"isrc": "QZ0000000001"}])
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    out = tmp_path / "email.json"
    assert m.run(pg, sp, args(email_output=str(out))) == 0
    kinds = sorted((e["market"], e["event"]) for e in pg.inserted)
    assert kinds == [("BR", "lost"), ("IN", "gained")]
    assert next(e for e in pg.inserted if e["event"] == "gained")["notified_at"] is None  # emailed now, acked after
    assert next(e for e in pg.inserted if e["event"] == "lost")["notified_at"] is None
    assert out.exists()


def test_run_dry_run_writes_nothing():
    pg = FakePg([cand()], [prev_row([]) | {"isrc": "QZ0000000001"}])
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    assert m.run(pg, sp, args(dry_run=True)) == 0
    assert pg.inserted == [] and pg.upserted == [] and pg.patched == []


def test_run_valve_writes_nothing():
    pg = FakePg([cand()], [])
    sp = UniverseSpotify(lists={TID: ["US"]}, error_markets={"BR", "IN"})
    assert m.run(pg, sp, args()) == m.EXIT_MISSING_VALVE
    assert pg.upserted == [] and pg.inserted == []


def test_run_budget_exceeded_writes_nothing_and_exits_nonzero():
    pg = FakePg([cand()], [])
    sp = UniverseSpotify(lists={TID: ["US"]})
    assert m.run(pg, sp, args(max_requests=1)) == m.EXIT_BUDGET
    assert pg.upserted == [] and pg.inserted == []


def test_skip_taken_down_drops_only_listed_isrcs():
    a, b = cand("QZ1"), cand("QZ2")
    kept, skipped = m.skip_taken_down([a, b], ["qz1"])
    assert kept == [b] and skipped == 1
    assert m.skip_taken_down([a, b], []) == ([a, b], 0)


def test_run_skips_taken_down_track_and_leaves_its_row_untouched(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a, **k: None)
    down, live = cand("QZ0000000001", tid="DOWN"), cand("QZ0000000002", tid=TID)
    pg = FakePg([down, live], [prev_row(["BR"]) | {"isrc": "QZ0000000001"}])
    pg.taken_down = ["QZ0000000001"]
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    assert m.run(pg, sp, args()) == 0
    assert [r["isrc"] for r in pg.upserted] == ["QZ0000000002"]
    assert pg.inserted == []
    assert all(ids != ("DOWN",) for ids, _ in sp.calls) and not any("DOWN" in ids for ids, _ in sp.calls)


def test_run_scans_track_again_once_takedown_watch_sees_it_back(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a, **k: None)
    pg = FakePg([cand("QZ0000000001")], [])
    pg.taken_down = []
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    assert m.run(pg, sp, args()) == 0
    assert [r["isrc"] for r in pg.upserted] == ["QZ0000000001"]


def test_run_new_track_with_gaps_records_lost_events_and_emails(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    pg = FakePg([cand("QZ0000000001")], [])
    pg.recent_tracks = ["QZ0000000001"]
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    out = tmp_path / "email.json"
    assert m.run(pg, sp, args(email_output=str(out))) == 0
    assert [(e["market"], e["event"], e["notified_at"]) for e in pg.inserted] == [("BR", "lost", None)]
    assert out.exists()


def test_run_old_untracked_track_still_seeds_silently(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a, **k: None)
    pg = FakePg([cand("QZ0000000001")], [])  # no recent tracks row: part of the bulk catalog
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    assert m.run(pg, sp, args()) == 0
    assert pg.inserted == [] and pg.upserted[0]["unavailable_markets"] == ["BR"]


def test_run_gained_events_are_emailed_not_silently_marked(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    pg = FakePg([cand()], [prev_row(["IN"]) | {"isrc": "QZ0000000001"}])
    sp = UniverseSpotify(lists={TID: ["IN", "US", "BR"]})
    out = tmp_path / "email.json"
    assert m.run(pg, sp, args(email_output=str(out))) == 0
    assert [(e["market"], e["event"], e["notified_at"]) for e in pg.inserted] == [("IN", "gained", None)]


def test_run_new_only_scans_only_new_tracks_without_a_row(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    monkeypatch.setattr(m, "send_email", lambda *a, **k: None)
    fresh = cand("QZ0000000001", tid=TID)
    has_row = cand("QZ0000000002", tid="HASROW")
    old_unscanned = cand("QZ0000000003", tid="OLD")
    down = cand("QZ0000000004", tid="DOWN")
    pg = FakePg([fresh, has_row, old_unscanned, down], [prev_row([]) | {"isrc": "QZ0000000002"}])
    pg.recent_tracks = ["QZ0000000001", "QZ0000000002", "QZ0000000004"]
    pg.taken_down = ["QZ0000000004"]
    sp = UniverseSpotify(lists={TID: ["IN", "US"]}, blocked={(TID, "BR")})
    assert m.run(pg, sp, args(new_only=True, max_requests=100)) == 0
    assert [r["isrc"] for r in pg.upserted] == ["QZ0000000001"]
    assert [(e["isrc"], e["market"], e["event"]) for e in pg.inserted] == [("QZ0000000001", "BR", "lost")]
    assert {i for ids, _ in sp.calls for i in ids} == {TID}


def test_run_new_only_makes_no_spotify_call_when_nothing_is_new():
    class NoCallSpotify(UniverseSpotify):
        def market_universe(self):
            raise AssertionError("must not call Spotify")

    pg = FakePg([cand("QZ0000000001")], [])  # no recent tracks row
    assert m.run(pg, NoCallSpotify(), args(new_only=True)) == 0
    assert pg.upserted == [] and pg.inserted == []


def test_run_new_track_with_uncertain_answer_is_deferred_not_written(monkeypatch):
    monkeypatch.setattr(m, "notify_web_revalidate", lambda: None)
    pg = FakePg([cand("QZ0000000001")], [])
    pg.recent_tracks = ["QZ0000000001"]
    sp = UniverseSpotify(lists={TID: ["US"]}, error_markets={"BR", "IN"})  # verify calls fail: uncertain
    assert m.run(pg, sp, args(new_only=True)) == 0
    assert pg.upserted == [] and pg.inserted == []
