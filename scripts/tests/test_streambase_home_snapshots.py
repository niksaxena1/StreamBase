from datetime import date
from unittest.mock import Mock, call

from streambase_home_snapshots import refresh_competitor_home_snapshots, refresh_own_home_snapshots


RUN_DATE = date(2026, 10, 11)


def test_own_refresh_calls_once():
    pg = Mock()
    refresh_own_home_snapshots(pg, RUN_DATE)
    pg.rpc.assert_called_once_with("refresh_home_diag_snapshots", {"p_run_date": "2026-10-11"})
    pg.select_all.assert_not_called()


def test_own_failure_warns_and_continues(capsys):
    pg = Mock()
    pg.rpc.side_effect = RuntimeError("timeout")
    refresh_own_home_snapshots(pg, RUN_DATE)
    assert "WARN" in capsys.readouterr().out


def test_competitor_refresh_all_and_active_label_loop():
    pg = Mock()
    pg.select_all.return_value = [{"label_key": "a"}, {"label_key": "b"}, {"label_key": "a"}]
    refresh_competitor_home_snapshots(pg, RUN_DATE)
    pg.select_all.assert_called_once_with(
        "labels", "label_key", "is_active=eq.true", order="label_key.asc", require_exact_count=True,
    )
    assert pg.rpc.call_args_list == [
        call("refresh_home_diag_snapshots", {"p_run_date": "2026-10-11", "p_label_key": label})
        for label in [None, "a", "b"]
    ]


def test_competitor_failures_do_not_stop_later_labels(capsys):
    pg = Mock()
    pg.select_all.return_value = [{"label_key": "a"}, {"label_key": "b"}]
    pg.rpc.side_effect = [RuntimeError("all failed"), RuntimeError("a failed"), None]
    refresh_competitor_home_snapshots(pg, RUN_DATE)
    assert pg.rpc.call_count == 3
    output = capsys.readouterr().out
    assert "WARN" in output and "competitor/__all" in output and "competitor/a" in output


def test_label_read_failure_warns_after_all_label_refresh(capsys):
    pg = Mock()
    pg.select_all.side_effect = RuntimeError("labels unavailable")
    refresh_competitor_home_snapshots(pg, RUN_DATE)
    pg.rpc.assert_called_once_with("refresh_home_diag_snapshots", {"p_run_date": "2026-10-11", "p_label_key": None})
    assert "WARN Could not load active labels" in capsys.readouterr().out


def test_malformed_label_response_warns_and_continues(capsys):
    pg = Mock()
    pg.select_all.return_value = [{}]
    refresh_competitor_home_snapshots(pg, RUN_DATE)
    assert "WARN Could not load active labels" in capsys.readouterr().out
