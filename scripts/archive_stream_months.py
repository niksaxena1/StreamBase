"""Archive old months of stream history to Cloudflare R2 and health-check the archive tier.

Files are gzip CSV (the Supabase Wrappers S3 foreign data wrapper cannot read Parquet from R2: ranged reads fail with
"service error", and its CSV reader only supports text columns, so the views cast). One file per universe per month:
  <prefix>/<own|competitor>/archive_<YYYY-MM>.csv.gz   header kind,d,isrc,v,oid,note,created_by,created_at
  kind s = stream row (v = cumulative streams); kind o = override row (d = date, v = override value, oid/note/... = metadata).
NULL is written as the two characters backslash-N.

Modes
  smoke     connectivity probe (kept for debugging).
  selftest  archive a COPY of the earliest compact month of each universe under <prefix>/_selftest/, serve it through
            the archive_selftest views (same view text as the live views), compare with the live views, prove that a
            recent-window query executes no foreign scan. Removes nothing from the real data. Alerts on failure only.
  archive   for every month that is due (older than the packed-months policy): export, upload, attach+verify through
            the FDW, then finalize (owner-installed RPC; if it is not installed yet the month stays in compact and one
            alert is raised). Alerts on failure only.

Secrets come from the environment and are never printed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
"""

import argparse
import csv
import gzip
import io
import json
import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import List, Tuple

from streambase_postgrest import Postgrest

NL = chr(10)
NULL = chr(92) + "N"
UNIVERSES = ("own", "competitor")
ISRC_PAGE = 1000
OVERRIDE_PAGE = 1000


def env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        raise RuntimeError(f"missing environment variable {name}")
    return v


def r2_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=f"https://{env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(retries={"max_attempts": 5, "mode": "standard"}, signature_version="s3v4"),
    )


def pg_client() -> Postgrest:
    return Postgrest(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"))


def parse_date(v) -> date:
    return date.fromisoformat(str(v)[:10])


def format_ts(v) -> str:
    if v is None:
        return NULL
    d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).isoformat()


def cell(v) -> str:
    return NULL if v is None else str(v)


def gz_csv(header: List[str], rows) -> bytes:
    sio = io.StringIO()
    w = csv.writer(sio, lineterminator=NL)
    w.writerow(header)
    for r in rows:
        w.writerow(r)
    return gzip.compress(sio.getvalue().encode("utf-8"), compresslevel=6, mtime=0)


def stream_rows(pg: Postgrest, universe: str, month: date) -> List[Tuple[str, str, int]]:
    """(date, isrc, streams) for every non-null day of the compact month, ordered by isrc then date."""
    out: List[Tuple[str, str, int]] = []
    after = ""
    while True:
        page = pg.rpc("stream_month_export", {"p_universe": universe, "p_month": month.isoformat(), "p_after_isrc": after, "p_limit": ISRC_PAGE}) or []
        if not page:
            break
        for r in page:
            for i, v in enumerate(r["vals"] or []):
                if v is not None:
                    out.append(((month + timedelta(days=i)).isoformat(), r["isrc"], int(v)))
        after = page[-1]["isrc"]
    return out


def override_rows(pg: Postgrest, universe: str, month: date) -> List[dict]:
    out: List[dict] = []
    after = 0
    while True:
        page = pg.rpc("stream_overrides_export", {"p_universe": universe, "p_month": month.isoformat(), "p_after_id": after, "p_limit": OVERRIDE_PAGE}) or []
        if not page:
            break
        out.extend(page)
        after = int(page[-1]["id"])
    return out


def build_file(pg: Postgrest, universe: str, month: date) -> Tuple[bytes, int, int]:
    """One gzip CSV per universe per month: kind s = stream row, kind o = override row."""
    streams = stream_rows(pg, universe, month)
    overrides = override_rows(pg, universe, month)

    def rows():
        for d, i, s_ in streams:
            yield ["s", d, i, s_, NULL, NULL, NULL, NULL]
        for r in overrides:
            yield [
                "o", str(r["date"])[:10], r["isrc"], r["streams_cumulative_override"], r["id"],
                cell(r.get("note")), cell(r.get("created_by")), format_ts(r.get("created_at")),
            ]

    body = gz_csv(["kind", "d", "isrc", "v", "oid", "note", "created_by", "created_at"], rows())
    return body, len(streams), len(overrides)


def archive_key(prefix: str, universe: str, month: date, selftest: bool = False) -> str:
    base = f"{prefix}/_selftest/{universe}" if selftest else f"{prefix}/{universe}"
    return f"{base}/archive_{month.strftime('%Y-%m')}.csv.gz"


def upload(s3, bucket: str, key: str, body: bytes) -> None:
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/gzip")


def alert(pg: Postgrest, universe: str, kind: str, subject: str, body: str) -> None:
    """Failure email via ops.pipeline_alerts. Manual (workflow_dispatch) runs only print unless STREAM_ARCHIVE_NOTIFY=true."""
    if os.environ.get("STREAM_ARCHIVE_NOTIFY", "").strip().lower() != "true":
        print(f"  (alert suppressed for this run: {subject})")
        return
    try:
        pg.rpc("stream_archive_alert", {"p_universe": universe, "p_kind": kind, "p_subject": subject, "p_body": body[:3500]})
    except Exception as e:  # never mask the original failure
        print(f"  could not queue alert: {e}")


def run_job(pg: Postgrest, kind: str, universe: str, month, timeout_s: int = 1500) -> dict:
    """Heavy steps (FDW reads of whole files) exceed the 8 s API statement timeout, so they run as one-shot pg_cron jobs
    (started at the next minute boundary) and are polled here."""
    jid = pg.rpc("stream_archive_enqueue", {"p_kind": kind, "p_universe": universe, "p_month": month.isoformat() if month else None})
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(5)
        st = pg.rpc("stream_archive_job_status", {"p_id": jid}) or {}
        if st.get("status") == "done":
            return st.get("result") or {}
        if st.get("status") == "failed":
            raise RuntimeError(st.get("error") or "job failed")
    raise RuntimeError(f"job {jid} ({kind} {universe} {month}) did not finish within {timeout_s}s")


def config(pg: Postgrest, key: str) -> str:
    return (pg.rpc("stream_archive_config_get", {"p_key": key}) or "").strip()


# ---------------------------------------------------------------------------------------------------------
def run_selftest() -> int:
    pg = pg_client()
    s3 = r2_client()
    bucket = env("R2_BUCKET")
    prefix = config(pg, "key_prefix")
    if config(pg, "bucket") != bucket:
        msg = "R2_BUCKET secret does not match ops.stream_archive_config bucket"
        alert(pg, "own", "stream_archive_selftest_failed", "[StreamBase] R2 archive self-test failed", msg)
        print(msg)
        return 1
    failed = False
    for universe in UNIVERSES:
        t0 = time.time()
        try:
            month = parse_date(pg.rpc("stream_archive_selftest_prepare", {"p_universe": universe}))
            body, n_s, n_o = build_file(pg, universe, month)
            t_export = time.time() - t0
            upload(s3, bucket, archive_key(prefix, universe, month, selftest=True), body)
            t_up = time.time() - t0 - t_export
            res = run_job(pg, "selftest_verify", universe, None)
            t_verify = time.time() - t0 - t_export - t_up
            print(f"[{universe}] month {month}: exported {n_s} stream rows + {n_o} overrides "
                  f"({len(body) // 1024} KiB gz); export {t_export:.1f}s, upload {t_up:.1f}s, verify {t_verify:.1f}s")
            print(json.dumps(res, indent=1, default=str))
            if not res.get("ok"):
                failed = True
                alert(pg, universe, "stream_archive_selftest_failed",
                      f"[StreamBase] R2 archive self-test failed ({universe} {month})", json.dumps(res, default=str))
        except Exception as e:
            failed = True
            print(f"[{universe}] self-test error: {e}")
            traceback.print_exc()
            alert(pg, universe, "stream_archive_selftest_failed",
                  f"[StreamBase] R2 archive self-test failed ({universe})", f"{type(e).__name__}: {e}")
    return 1 if failed else 0


def run_archive() -> int:
    pg = pg_client()
    s3 = r2_client()
    bucket = env("R2_BUCKET")
    prefix = config(pg, "key_prefix")
    failed = False
    budget_s = float(os.environ.get("STREAM_ARCHIVE_BUDGET_MIN", "35")) * 60
    t_start = time.time()
    for universe in UNIVERSES:
        due = [parse_date(r["month"]) for r in (pg.rpc("stream_archive_due", {"p_universe": universe}) or [])]
        print(f"[{universe}] due months: {[d.isoformat() for d in due] or 'none'}")
        for month in due:
            if time.time() - t_start > budget_s:
                print(f"[{universe}] time budget reached; remaining months are picked up by the next run")
                break
            try:
                body, n_s, n_o = build_file(pg, universe, month)
                upload(s3, bucket, archive_key(prefix, universe, month), body)
                res = run_job(pg, "attach", universe, month)
                print(f"[{universe}] {month}: attached ({n_s} stream rows, {n_o} overrides) {json.dumps(res, default=str)}")
                try:
                    fin = run_job(pg, "finalize", universe, month)
                    print(f"[{universe}] {month}: finalized {json.dumps(fin, default=str)}")
                except RuntimeError as e:
                    if "finalize not installed" in str(e):
                        print(f"[{universe}] {month}: finalize RPC not installed (owner paste pending); month stays in compact")
                        alert(pg, universe, f"stream_archive_finalize_missing_{month.strftime('%Y_%m')}",
                              f"[StreamBase] Archive finalize step not installed ({universe} {month})",
                              "The month was archived and verified in R2 but ops.archive_finalize_month is not installed, "
                              "so the compact copy was kept. Run supabase/manual/2026-10-12_stream_archive_finalize.sql once.")
                    else:
                        raise
            except Exception as e:
                failed = True
                print(f"[{universe}] {month}: ERROR {e}")
                traceback.print_exc()
                alert(pg, universe, f"stream_archive_failed_{month.strftime('%Y_%m')}",
                      f"[StreamBase] R2 archiving failed ({universe} {month})", f"{type(e).__name__}: {e}")
    return 1 if failed else 0


def run_smoke() -> int:
    pg = pg_client()
    s3 = r2_client()
    bucket = env("R2_BUCKET")
    key = f"{config(pg, 'key_prefix')}/_selftest/smoke_gz.csv.gz"
    body = gz_csv(["d", "isrc", "streams"], [["2026-01-01", "USAAA0000001", 1]])
    upload(s3, bucket, key, body)
    print(f"uploaded {key} ({len(body)} bytes)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["smoke", "selftest", "archive"])
    args = ap.parse_args()
    rc = {"smoke": run_smoke, "selftest": run_selftest, "archive": run_archive}[args.mode]()
    try:
        pg_client().rpc("stream_archive_cleanup_jobs", {})
    except Exception as e:  # housekeeping only
        print(f"  cleanup of finished cron one-shots failed: {e}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
