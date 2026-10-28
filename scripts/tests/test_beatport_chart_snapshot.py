import copy
import json
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest import mock

import requests

import beatport_chart_snapshot as bp

FIXTURE = Path(__file__).parent / "fixtures" / "beatport_top100_sample.html"


def html_with_items(items, query_key="genre-11-top-100-tracks-per_page=100&hype=false"):
    nd = {
        "props": {
            "pageProps": {
                "dehydratedState": {
                    "queries": [
                        {"queryKey": ["other-query"], "state": {"data": {"results": [{"foo": 1}]}}},
                        {"queryKey": [query_key], "state": {"data": {"results": items}}},
                    ]
                }
            }
        }
    }
    return f'<html><script id="__NEXT_DATA__" type="application/json">{json.dumps(nd)}</script></html>'


def fake_items(n):
    return [
        {
            "id": 1000 + i,
            "name": f"Track {i}",
            "mix_name": "Extended",
            "artists": [{"name": f"Artist {i}"}],
            "remixers": [],
            "isrc": f"ISRC{i:08d}",
            "bpm": 126,
            "key": {"name": "A Major", "camelot_number": 11, "camelot_letter": "B"},
            "length_ms": 300000,
            "new_release_date": "2026-10-01",
            "slug": f"track-{i}",
            "release": {
                "name": "R",
                "label": {"name": "L"},
                "image": {"dynamic_uri": "https://x/{w}x{h}/a.jpg"},
            },
        }
        for i in range(n)
    ]


class FakeResp:
    def __init__(self, status=200, text=""):
        self.status_code = status
        self.text = text


class FakePg:
    def __init__(self, existing_first=None):
        self.calls = []
        self.existing_first = existing_first or {}

    def select(self, table, select, filters):
        self.calls.append(("select", table))
        return [
            {"source_track_id": k, "first_seen": v} for k, v in self.existing_first.items()
        ]

    def upsert(self, table, rows, on_conflict):
        self.calls.append(("upsert", table, rows, on_conflict))

    def delete(self, table, filters):
        self.calls.append(("delete", table, filters))

    def insert(self, table, rows):
        self.calls.append(("insert", table, rows))
        return rows


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.entries = bp.parse_chart_html(FIXTURE.read_text(encoding="utf-8"))

    def test_positions_follow_chart_order(self):
        self.assertEqual([e["position"] for e in self.entries], [1, 2, 3])

    def test_fields_camelot_image_and_url(self):
        t = self.entries[0]["track"]
        self.assertEqual(t["source"], "beatport")
        self.assertEqual(t["source_track_id"], 30785451)
        self.assertEqual(t["name"], "DANGER DANGER")
        self.assertEqual(t["mix_name"], "Extended")
        self.assertEqual(t["artists"], ["Solomun", "Skepta", "Dom Dolla"])
        self.assertEqual(t["camelot"], "11B")
        self.assertEqual(t["musical_key"], "A Major")
        self.assertEqual(t["label_name"], "Three Six Zero Recordings")
        self.assertEqual(t["bpm"], 130)
        self.assertEqual(t["track_url"], "https://www.beatport.com/track/danger-danger/30785451")
        self.assertIn("/200x200/", t["image_url"])
        self.assertNotIn("{w}", t["image_url"])
        self.assertEqual(t["release_date"], "2026-10-02")

    def test_release_date_falls_back_to_publish_date_and_remixers(self):
        t = self.entries[1]["track"]
        self.assertEqual(t["release_date"], "2026-10-16")
        self.assertEqual(t["remixers"], ["Test Remixer"])

    def test_finds_results_by_content_not_index(self):
        entries = bp.parse_chart_html(html_with_items(fake_items(5)))
        self.assertEqual(len(entries), 5)


class ValidationTests(unittest.TestCase):
    def test_accepts_100_entries(self):
        bp.validate_entries(bp.parse_chart_html(html_with_items(fake_items(100))))

    def test_too_few_entries(self):
        entries = bp.parse_chart_html(html_with_items(fake_items(50)))
        with self.assertRaises(bp.ChartValidationError):
            bp.validate_entries(entries)

    def test_duplicate_positions(self):
        entries = bp.parse_chart_html(html_with_items(fake_items(100)))
        entries[5]["position"] = 4
        with self.assertRaises(bp.ChartValidationError):
            bp.validate_entries(entries)

    def test_missing_id_or_name(self):
        entries = bp.parse_chart_html(html_with_items(fake_items(100)))
        broken = copy.deepcopy(entries)
        broken[0]["track"]["source_track_id"] = None
        with self.assertRaises(bp.ChartValidationError):
            bp.validate_entries(broken)
        broken = copy.deepcopy(entries)
        broken[3]["track"]["name"] = " "
        with self.assertRaises(bp.ChartValidationError):
            bp.validate_entries(broken)

    def test_missing_next_data(self):
        with self.assertRaises(bp.ChartParseError):
            bp.parse_chart_html("<html>nothing</html>")


class RetryTests(unittest.TestCase):
    GOOD = html_with_items(fake_items(100))

    def run_fetch(self, responses):
        sleeps = []
        get = mock.Mock(side_effect=responses)
        result = None
        error = None
        try:
            result = bp.fetch_chart_entries("https://example/x", http_get=get, sleep=sleeps.append, log=lambda *_: None)
        except Exception as exc:  # noqa: BLE001
            error = exc
        return result, error, get, sleeps

    def test_sends_honest_user_agent(self):
        _, _, get, _ = self.run_fetch([FakeResp(200, self.GOOD)])
        self.assertEqual(get.call_args.kwargs["headers"]["User-Agent"], bp.USER_AGENT)
        self.assertIn("StreamBase-ChartSnapshot", bp.USER_AGENT)

    def test_retries_5xx_with_backoff_then_succeeds(self):
        result, error, get, sleeps = self.run_fetch([FakeResp(503), FakeResp(502), FakeResp(200, self.GOOD)])
        self.assertIsNone(error)
        self.assertEqual(len(result), 100)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(sleeps, [5, 20])

    def test_gives_up_after_three_attempts(self):
        _, error, get, _ = self.run_fetch([FakeResp(500)] * 3)
        self.assertIsInstance(error, bp.ChartFetchError)
        self.assertEqual(get.call_count, 3)

    def test_network_error_retried(self):
        result, error, get, _ = self.run_fetch([requests.exceptions.ConnectionError("x"), FakeResp(200, self.GOOD)])
        self.assertIsNone(error)
        self.assertEqual(get.call_count, 2)

    def test_missing_data_retried(self):
        result, error, get, _ = self.run_fetch([FakeResp(200, "<html></html>"), FakeResp(200, self.GOOD)])
        self.assertIsNone(error)
        self.assertEqual(get.call_count, 2)

    def test_blocked_status_retried_at_most_once(self):
        _, error, get, _ = self.run_fetch([FakeResp(429)] * 3)
        self.assertIsInstance(error, bp.ChartFetchError)
        self.assertEqual(get.call_count, 2)
        _, error, get, _ = self.run_fetch([FakeResp(403), FakeResp(403), FakeResp(200, self.GOOD)])
        self.assertIsNotNone(error)
        self.assertEqual(get.call_count, 2)

    def test_other_4xx_not_retried(self):
        _, error, get, _ = self.run_fetch([FakeResp(404)])
        self.assertIsInstance(error, bp.ChartFetchError)
        self.assertEqual(get.call_count, 1)


class WriteTests(unittest.TestCase):
    NOW = datetime(2026, 10, 28, 10, 0, tzinfo=timezone.utc)

    def entries(self, n=100):
        return bp.parse_chart_html(html_with_items(fake_items(n)))

    def test_write_order_tracks_snapshot_delete_insert(self):
        pg = FakePg()
        bp.write_snapshot(pg, "beatport_tech_house_top100", self.entries(), date(2026, 10, 28), self.NOW)
        ops = [(c[0], c[1]) for c in pg.calls if c[0] != "select"]
        self.assertEqual(
            ops,
            [("upsert", "tracks"), ("upsert", "snapshots"), ("delete", "entries"), ("insert", "entries")],
        )
        snapshot = next(c for c in pg.calls if c[:2] == ("upsert", "snapshots"))
        self.assertEqual(snapshot[2][0]["entry_count"], 100)
        self.assertEqual(snapshot[2][0]["snapshot_date"], "2026-10-28")
        delete = next(c for c in pg.calls if c[0] == "delete")
        self.assertIn("snapshot_date=eq.2026-10-28", delete[2])
        inserted = next(c for c in pg.calls if c[0] == "insert")[2]
        self.assertEqual([r["position"] for r in inserted], list(range(1, 101)))

    def test_first_seen_keeps_earliest(self):
        pg = FakePg(existing_first={1000: "2026-09-01"})
        bp.write_snapshot(pg, "k", self.entries(), date(2026, 10, 28), self.NOW)
        rows = next(c for c in pg.calls if c[:2] == ("upsert", "tracks"))[2]
        by_id = {r["source_track_id"]: r for r in rows}
        self.assertEqual(by_id[1000]["first_seen"], "2026-09-01")
        self.assertEqual(by_id[1001]["first_seen"], "2026-10-28")
        self.assertEqual(by_id[1001]["last_seen"], "2026-10-28")

    def test_invalid_chart_writes_nothing(self):
        pg = FakePg()
        small = html_with_items(fake_items(10))
        tmp = Path(__file__).parent / "fixtures" / "beatport_top100_sample.html"
        with mock.patch("builtins.open", mock.mock_open(read_data=small)):
            with self.assertRaises(bp.ChartValidationError):
                bp.process_chart({"chart_key": "k", "url": "u"}, pg, html_file=str(tmp))
        self.assertEqual(pg.calls, [])

    def test_dry_run_writes_nothing(self):
        pg = FakePg()
        good = html_with_items(fake_items(100))
        with mock.patch("builtins.open", mock.mock_open(read_data=good)):
            n = bp.process_chart({"chart_key": "k", "url": "u"}, pg, html_file="x.html", dry_run=True)
        self.assertEqual(n, 100)
        self.assertEqual(pg.calls, [])


if __name__ == "__main__":
    unittest.main()
