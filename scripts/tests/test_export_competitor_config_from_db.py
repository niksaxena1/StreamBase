import csv
import io
from pathlib import Path

import export_competitor_config_from_db as m

REPO_CSV = Path(__file__).resolve().parents[2] / "config" / "competitor_playlists.csv"


def _db_rows_from_csv(rows):
    """What competitor.playlists holds for the committed CSV after the backfill migration."""
    return [
        {
            "playlist_key": r["playlist_key"],
            "label_key": r["label_key"],
            "display_name": r["display_name"],
            "sot_playlist_id": int(r["sot_playlist_id"]),
            "sot_dashboard_url": r["dashboard_url"],
            "sot_dashboard_name": r["sot_dashboard_name"],
            "min_rows": int(r["min_rows"]),
            "is_active": True,
        }
        for r in rows
    ]


def test_generated_csv_round_trips_the_committed_file():
    committed = m.read_csv_rows(str(REPO_CSV))
    assert committed, "fixture CSV should not be empty"
    labels = {r["label_key"] for r in committed}
    rows, warnings = m.build_rows(_db_rows_from_csv(committed), labels, committed)
    assert warnings == []
    assert m.diff_keys(committed, rows) == []
    rendered = list(csv.DictReader(io.StringIO(m.render_csv(rows))))
    assert rendered == committed


def test_ui_added_playlist_is_included_and_inactive_is_dropped():
    committed = [
        {"playlist_key": "a_releases", "display_name": "A", "label_key": "a", "is_catalog": "true",
         "playlist_type": "Competitor", "dashboard_url": "https://www.spotontrack.com/dashboard/1",
         "sot_playlist_id": "11", "sot_dashboard_name": "A", "min_rows": "1"},
        {"playlist_key": "old_releases", "display_name": "Old", "label_key": "old", "is_catalog": "true",
         "playlist_type": "Competitor", "dashboard_url": "https://www.spotontrack.com/dashboard/2",
         "sot_playlist_id": "22", "sot_dashboard_name": "Old", "min_rows": "1"},
    ]
    db = [
        {"playlist_key": "a_releases", "label_key": "a", "display_name": "A", "sot_playlist_id": 11,
         "sot_dashboard_url": "https://www.spotontrack.com/dashboard/1", "sot_dashboard_name": None,
         "min_rows": 1, "is_active": True},
        {"playlist_key": "old_releases", "label_key": "old", "display_name": "Old", "sot_playlist_id": 22,
         "sot_dashboard_url": "https://www.spotontrack.com/dashboard/2", "is_active": False},
        {"playlist_key": "new_releases", "label_key": "new", "display_name": "New Label Releases",
         "sot_playlist_id": 33, "sot_dashboard_url": "https://www.spotontrack.com/dashboard/3",
         "sot_dashboard_name": None, "min_rows": None, "is_active": True},
    ]
    rows, warnings = m.build_rows(db, {"a", "old", "new"}, committed)
    keys = [r["playlist_key"] for r in rows]
    assert keys == ["a_releases", "new_releases"]
    new = rows[1]
    assert new["sot_dashboard_name"] == "New Label Releases" and new["min_rows"] == "1"
    assert new["is_catalog"] == "true" and new["playlist_type"] == "Competitor"
    assert m.diff_keys(committed, rows) == [
        "+ new_releases (in DB, not in committed CSV)",
        "- old_releases (in committed CSV, inactive/missing in DB)",
    ]


def test_inactive_label_drops_its_playlists():
    db = [{"playlist_key": "x", "label_key": "gone", "display_name": "X", "sot_playlist_id": 1,
           "sot_dashboard_url": "https://www.spotontrack.com/dashboard/9", "is_active": True}]
    rows, _ = m.build_rows(db, set(), [])
    assert rows == []


def test_csv_only_rows_are_kept_with_warning():
    committed = [{"playlist_key": "legacy", "display_name": "L", "label_key": "l",
                  "dashboard_url": "https://www.spotontrack.com/dashboard/5"}]
    rows, warnings = m.build_rows([], set(), committed)
    assert [r["playlist_key"] for r in rows] == ["legacy"]
    assert "not in competitor.playlists" in warnings[0]


def test_db_failure_leaves_committed_csv_untouched(tmp_path, monkeypatch):
    csv_path = tmp_path / "c.csv"
    csv_path.write_text("playlist_key,display_name\nk,K\n", encoding="utf-8")
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert m.main(["--csv", str(csv_path)]) == 0
    assert csv_path.read_text(encoding="utf-8") == "playlist_key,display_name\nk,K\n"
    assert m.main(["--csv", str(csv_path), "--strict"]) == 2
