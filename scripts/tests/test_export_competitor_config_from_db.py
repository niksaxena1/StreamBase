import csv
import io
from pathlib import Path
from unittest.mock import Mock

import pytest

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
    original = REPO_CSV.read_bytes()
    newline = "\r\n" if b"\r\n" in original else "\n"
    assert m.render_csv(rows, newline).encode("utf-8-sig") == original


def test_main_round_trips_current_csv_bytes_with_reordered_db(tmp_path, monkeypatch):
    snapshot = tmp_path / "competitor_playlists.csv"
    snapshot.write_bytes(REPO_CSV.read_bytes())
    committed = m.read_csv_rows(str(snapshot))
    pg = Mock()
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    factory = Mock(return_value=pg)
    monkeypatch.setattr(m, "Postgrest", factory)
    monkeypatch.setattr(m, "load_from_db", lambda client: (
        list(reversed(_db_rows_from_csv(committed))), {r["label_key"] for r in committed},
    ))
    assert m.main(["--csv", str(snapshot)]) == 0
    assert snapshot.read_bytes() == REPO_CSV.read_bytes()
    factory.assert_called_once_with(
        "https://example.invalid", "test-key", schema="competitor", timeout_s=15, max_retries=1,
    )


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


@pytest.mark.parametrize("failure", ["network", "schema", "malformed", "empty", "missing_dashboard"])
def test_db_errors_preserve_snapshot_bytes(tmp_path, monkeypatch, failure):
    snapshot = tmp_path / "competitor_playlists.csv"
    original = REPO_CSV.read_bytes()
    snapshot.write_bytes(original)
    rows = m.read_csv_rows(str(snapshot))
    db = _db_rows_from_csv(rows)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setattr(m, "Postgrest", Mock())
    if failure in ("network", "schema"):
        monkeypatch.setattr(m, "load_from_db", Mock(side_effect=RuntimeError(failure)))
    else:
        if failure == "malformed":
            db[0]["min_rows"] = "invalid"
        elif failure == "missing_dashboard":
            db[0]["sot_dashboard_url"] = None
        else:
            for row in db:
                row["is_active"] = False
        monkeypatch.setattr(m, "load_from_db", lambda pg: (db, {r["label_key"] for r in rows}))
    assert m.main(["--csv", str(snapshot)]) == 0
    assert snapshot.read_bytes() == original
    assert m.main(["--csv", str(snapshot), "--check"]) == 2


def test_write_failure_preserves_snapshot(tmp_path, monkeypatch):
    snapshot = tmp_path / "c.csv"
    snapshot.write_bytes(REPO_CSV.read_bytes())
    rows = m.read_csv_rows(str(snapshot))
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setattr(m, "Postgrest", Mock())
    monkeypatch.setattr(m, "load_from_db", lambda pg: (_db_rows_from_csv(rows), {r["label_key"] for r in rows}))
    monkeypatch.setattr(m.os, "replace", Mock(side_effect=OSError("write failed")))
    assert m.main(["--csv", str(snapshot)]) == 0
    assert snapshot.read_bytes() == REPO_CSV.read_bytes()
    assert list(tmp_path.iterdir()) == [snapshot]


def test_drift_check_does_not_write(tmp_path, monkeypatch):
    snapshot = tmp_path / "c.csv"
    snapshot.write_bytes(REPO_CSV.read_bytes())
    rows = m.read_csv_rows(str(snapshot))
    db = _db_rows_from_csv(rows)
    db[0]["min_rows"] = 5
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    monkeypatch.setattr(m, "Postgrest", Mock())
    monkeypatch.setattr(m, "load_from_db", lambda pg: (db, {r["label_key"] for r in rows}))
    assert m.main(["--csv", str(snapshot), "--check"]) == 1
    assert snapshot.read_bytes() == REPO_CSV.read_bytes()


def test_extra_csv_knobs_survive_db_merge():
    committed = m.read_csv_rows(str(REPO_CSV))
    committed[0]["allow_empty"] = "true"
    rows, _ = m.build_rows(_db_rows_from_csv(committed), {r["label_key"] for r in committed}, committed)
    assert rows[0]["allow_empty"] == "true"
    assert "allow_empty" in m.render_csv(rows).splitlines()[0]


def test_migration_backfills_every_current_csv_row():
    migration = REPO_CSV.parents[1] / "migrations" / "add_competitor_onboarding_config_columns.sql"
    sql = migration.read_text(encoding="utf-8")
    rows = m.read_csv_rows(str(REPO_CSV))
    for row in rows:
        name = row["sot_dashboard_name"].replace("'", "''")
        assert f"SET sot_dashboard_name = '{name}', min_rows = {row['min_rows']}" in sql
        assert f"WHERE playlist_key = '{row['playlist_key']}' AND sot_dashboard_name IS NULL;" in sql
    assert sql.count("UPDATE competitor.playlists SET") == len(rows)
