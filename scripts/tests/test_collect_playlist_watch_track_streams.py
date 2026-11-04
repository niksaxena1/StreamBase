import unittest

from scripts.collect_playlist_watch_track_streams import (
    normalize_items,
    parse_playcount,
    plan_memberships,
    tracks_to_collect,
)

A, B, C, D = "A" * 22, "B" * 22, "C" * 22, "D" * 22


def item(tid, added="2026-11-01T10:00:00Z", **extra):
    track = {"type": "track", "id": tid, "name": f"n{tid[0]}", "external_ids": {"isrc": "X"},
             "artists": [{"name": "One"}, {"name": "Two"}],
             "album": {"name": "Alb", "release_date": "2026-10-01",
                       "images": [{"url": "big", "width": 640}, {"url": "small", "width": 64}, {"url": "tiny", "width": 32}]}}
    track.update(extra)
    return {"added_at": added, "is_local": False, "track": track}


class TrackStreamsCollectorTests(unittest.TestCase):
    def test_normalize_skips_local_episodes_null_and_duplicates(self):
        items = [
            item(A),
            {"is_local": True, "track": {"type": "track", "id": B}},
            item(C, type="episode"),
            {"track": None},
            item(A),
            item(D),
        ]
        rows = normalize_items(items)
        self.assertEqual([r["spotify_track_id"] for r in rows], [A, D])
        self.assertEqual([r["position"] for r in rows], [0, 1])
        self.assertEqual(rows[0]["artists"], "One, Two")
        self.assertEqual(rows[0]["image_url"], "small")

    def test_plan_memberships_new_kept_readded_removed(self):
        current = normalize_items([item(A), item(B), item(D)])
        existing = [
            {"spotify_track_id": A, "first_seen_date": "2026-10-01", "removed_date": None},
            {"spotify_track_id": C, "first_seen_date": "2026-10-01", "removed_date": None},
            {"spotify_track_id": D, "first_seen_date": "2026-09-01", "removed_date": "2026-10-20"},
        ]
        upserts, removed = plan_memberships("P" * 22, current, existing, "2026-11-06")
        by = {u["spotify_track_id"]: u for u in upserts}
        self.assertEqual(by[A]["first_seen_date"], "2026-10-01")
        self.assertEqual(by[B]["first_seen_date"], "2026-11-06")
        self.assertEqual(by[D]["first_seen_date"], "2026-09-01")  # re-added keeps history
        self.assertIsNone(by[D]["removed_date"])
        self.assertTrue(all(u["last_seen_date"] == "2026-11-06" for u in upserts))
        self.assertEqual(removed, [C])

    def test_tracks_to_collect_includes_removed_inside_retention(self):
        current = normalize_items([item(A)])
        existing = [
            {"spotify_track_id": A, "removed_date": None},
            {"spotify_track_id": B, "removed_date": "2026-10-10"},  # 27 days ago -> keep
            {"spotify_track_id": C, "removed_date": "2026-09-01"},  # too old -> drop
            {"spotify_track_id": D, "removed_date": None},          # removed today
        ]
        ids = tracks_to_collect(current, existing, [D], "2026-11-06", 30)
        self.assertEqual(ids, [A, B, D])

    def test_parse_playcount(self):
        self.assertEqual(parse_playcount({"data": {"trackUnion": {"playcount": "39390"}}}), 39390)
        self.assertIsNone(parse_playcount({"data": {"trackUnion": {"playcount": None}}}))
        self.assertIsNone(parse_playcount({"data": {"trackUnion": None}}))
        with self.assertRaises(RuntimeError):
            parse_playcount({"errors": [{"message": "PersistedQueryNotFound"}]})


if __name__ == "__main__":
    unittest.main()
