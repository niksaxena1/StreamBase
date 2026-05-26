import unittest

from scripts.evaluate_playlist_watch_alerts import AlertRule, Snapshot, evaluate_rule_for_playlist


class PlaylistWatchAlertEvaluatorTests(unittest.TestCase):
    def test_alerts_when_today_exceeds_seven_day_average_by_absolute_and_percent_thresholds(self):
        rule = AlertRule(
            id=7,
            user_id="user-1",
            recipient_email="listener@example.com",
            rule_name="Spike watch",
            min_absolute_jump=300,
            min_percent_jump=20,
            comparison_window_days=7,
        )
        snapshots = [
            Snapshot("2026-05-19", 1000),
            Snapshot("2026-05-20", 1020),
            Snapshot("2026-05-21", 980),
            Snapshot("2026-05-22", 1010),
            Snapshot("2026-05-23", 995),
            Snapshot("2026-05-24", 1005),
            Snapshot("2026-05-25", 990),
            Snapshot("2026-05-26", 1400),
        ]

        event = evaluate_rule_for_playlist(
            rule,
            playlist={"spotify_playlist_id": "playlist-1", "display_name": "Big List"},
            snapshots=snapshots,
            run_date="2026-05-26",
        )

        self.assertIsNotNone(event)
        self.assertEqual(event["absolute_jump"], 400)
        self.assertAlmostEqual(event["percent_jump"], 40.0)
        self.assertEqual(event["baseline_count"], 1000)

    def test_requires_all_configured_thresholds_to_match(self):
        rule = AlertRule(
            id=8,
            user_id="user-1",
            recipient_email="listener@example.com",
            rule_name="Big absolute only",
            min_absolute_jump=500,
            min_percent_jump=20,
            comparison_window_days=7,
        )
        snapshots = [
            Snapshot("2026-05-19", 1000),
            Snapshot("2026-05-20", 1000),
            Snapshot("2026-05-21", 1000),
            Snapshot("2026-05-22", 1000),
            Snapshot("2026-05-23", 1000),
            Snapshot("2026-05-24", 1000),
            Snapshot("2026-05-25", 1000),
            Snapshot("2026-05-26", 1300),
        ]

        event = evaluate_rule_for_playlist(rule, {"spotify_playlist_id": "playlist-1"}, snapshots, "2026-05-26")

        self.assertIsNone(event)

    def test_does_not_alert_without_enough_baseline_history(self):
        rule = AlertRule(
            id=9,
            user_id="user-1",
            recipient_email="listener@example.com",
            rule_name="Needs history",
            min_absolute_jump=100,
            min_percent_jump=None,
            comparison_window_days=7,
        )
        snapshots = [Snapshot("2026-05-25", 1000), Snapshot("2026-05-26", 1200)]

        event = evaluate_rule_for_playlist(rule, {"spotify_playlist_id": "playlist-1"}, snapshots, "2026-05-26")

        self.assertIsNone(event)


if __name__ == "__main__":
    unittest.main()
