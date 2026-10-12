import unittest
from datetime import date

from streambase_postgrest import upsert_daily_streams


class FakePg:
    def __init__(self, hot_from="2026-07-01", fail_upsert=False, fail_hot=False):
        self.hot_from = hot_from
        self.fail_upsert = fail_upsert
        self.fail_hot = fail_hot
        self.upserts = []
        self.rpcs = []

    def rpc(self, name, params=None):
        self.rpcs.append((name, params))
        if name == "stream_history_hot_from":
            if self.fail_hot:
                raise RuntimeError("down")
            return self.hot_from
        return None

    def upsert(self, table, rows, on_conflict):
        if self.fail_upsert:
            raise RuntimeError("no partition")
        self.upserts.append((table, rows, on_conflict))


class UpsertDailyStreamsTests(unittest.TestCase):
    def test_recent_date_writes_without_packing(self):
        pg = FakePg()
        logs = []
        self.assertTrue(upsert_daily_streams(pg, [{"isrc": "A"}], date(2026, 10, 11), log=logs.append))
        self.assertEqual(len(pg.upserts), 1)
        self.assertEqual([c[0] for c in pg.rpcs], ["stream_history_hot_from"])
        self.assertEqual(logs, [])

    def test_packed_date_repacks_after_successful_write(self):
        pg = FakePg()
        logs = []
        self.assertTrue(upsert_daily_streams(pg, [{"isrc": "A"}], date(2026, 6, 15), log=logs.append))
        self.assertIn(("pack_stream_month", {"p_month": "2026-06-01"}), pg.rpcs)
        self.assertTrue(any("packed history" in m for m in logs))

    def test_packed_date_without_partition_warns_and_skips(self):
        pg = FakePg(fail_upsert=True)
        logs = []
        self.assertFalse(upsert_daily_streams(pg, [{"isrc": "A"}], date(2026, 6, 15), log=logs.append))
        self.assertNotIn("pack_stream_month", [c[0] for c in pg.rpcs])
        self.assertTrue(any("skipped" in m for m in logs))

    def test_recent_write_failure_still_raises(self):
        pg = FakePg(fail_upsert=True)
        with self.assertRaises(RuntimeError):
            upsert_daily_streams(pg, [{"isrc": "A"}], date(2026, 10, 11), log=lambda m: None)

    def test_cutoff_lookup_failure_does_not_block_ingestion(self):
        pg = FakePg(fail_hot=True)
        self.assertTrue(upsert_daily_streams(pg, [{"isrc": "A"}], date(2026, 10, 11), log=lambda m: None))


if __name__ == "__main__":
    unittest.main()
