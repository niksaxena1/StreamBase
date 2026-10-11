"""Best-effort Home diagnostics refresh; clients retain their ingestion schema."""

from datetime import date

from streambase_postgrest import Postgrest


def _refresh(pg: Postgrest, run_date: date, label_key=None, *, competitor=False):
    params = {"p_run_date": run_date.isoformat()}
    if competitor:
        params["p_label_key"] = label_key
    try:
        pg.rpc("refresh_home_diag_snapshots", params)
    except Exception as exc:
        scope = f"competitor/{label_key or '__all'}" if competitor else "own"
        print(f"WARN Could not refresh Home diagnostic snapshots ({scope}): {exc}")


def refresh_own_home_snapshots(pg: Postgrest, run_date: date):
    _refresh(pg, run_date)


def refresh_competitor_home_snapshots(pg: Postgrest, run_date: date):
    _refresh(pg, run_date, competitor=True)
    try:
        labels = pg.select_all(
            "labels", "label_key", "is_active=eq.true", order="label_key.asc",
            require_exact_count=True,
        )
        label_keys = list(dict.fromkeys(row["label_key"] for row in labels))
    except Exception as exc:
        print(f"WARN Could not load active labels for Home diagnostic snapshots: {exc}")
        return
    for label_key in label_keys:
        _refresh(pg, run_date, label_key, competitor=True)
