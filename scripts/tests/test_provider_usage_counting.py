from scripts import rapidapi_stale_fix as rapid


class FakePg:
    def __init__(self, rows):
        self.rows = dict(rows)  # (usage_date, provider) -> calls

    def select(self, table, cols, query):
        parts = dict(p.split("=", 1) for p in query.split("&"))
        key = (parts["usage_date"][3:], parts["provider"][3:])
        return [{"calls": self.rows[key]}] if key in self.rows else []

    def upsert(self, table, rows, on_conflict):
        for row in rows:
            self.rows[(row["usage_date"], row["provider"])] = row["calls"]


def test_monthly_provider_row_holds_only_that_days_calls(monkeypatch):
    monkeypatch.setattr(rapid, "_TODAY_CALLS", {})
    pg = FakePg({("2026-10-14", "checkleakedcc"): 43})
    usage = {"checkleakedcc": 300}  # month-to-date quota view
    for _ in range(5):
        rapid.record_provider_call(pg, "2026-10-15", "checkleakedcc", usage)
    assert usage["checkleakedcc"] == 305
    assert pg.rows[("2026-10-15", "checkleakedcc")] == 5
    assert pg.rows[("2026-10-14", "checkleakedcc")] == 43


def test_second_run_same_day_continues_from_stored_count(monkeypatch):
    monkeypatch.setattr(rapid, "_TODAY_CALLS", {})
    pg = FakePg({("2026-10-15", "beat_analytics"): 12})
    rapid.record_provider_call(pg, "2026-10-15", "beat_analytics", {"beat_analytics": 12})
    assert pg.rows[("2026-10-15", "beat_analytics")] == 13
