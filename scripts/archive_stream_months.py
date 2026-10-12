"""Archive old months of stream history to Cloudflare R2 (Parquet) and health-check the archive tier.

Modes
  smoke     upload a tiny Parquet file with every column type used by the archive and read it back through the
            Postgres S3 foreign data wrapper (connectivity / type-mapping check).
  selftest  archive a COPY of the earliest compact month of each universe under <prefix>/_selftest/, attach it in
            the archive_selftest schema and verify it against compact through the FDW. Removes nothing from the
            real data. Alerts (email) on failure only.
  archive   archive every month that is due (older than the packed-months policy) for both universes, verify the
            FDW read against compact, then finalize (remove the compact rows and archived override rows).
            Alerts on failure only.

Secrets come from the environment (never printed): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID,
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
"""

import argparse
import io
import json
import os
import sys
import time
import traceback
from datetime import date, datetime, timezone
from typing import Callable, Dict, List, Optional, Tuple

import pyarrow as pa
import pyarrow.parquet as pq
import requests

from streambase_postgrest import Postgrest

PAGE = 20000
NL = chr(10)
UNIVERSES = ("own", "competitor")

STREAM_SCHEMA = pa.schema([
    ("date", pa.date32()),
    ("isrc", pa.string()),
    ("streams_cumulative", pa.int64()),
])
OVERRIDE_SCHEMA = pa.schema([
    ("id", pa.int64()),
    ("date", pa.date32()),
    ("isrc", pa.string()),
    ("streams_cumulative_override", pa.int64()),
    ("note", pa.string()),
    ("created_by", pa.string()),
    ("created_at", pa.timestamp("us", tz="UTC")),
])


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


def to_parquet_bytes(table: pa.Table) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd", use_dictionary=True)
    return buf.getvalue()


def parse_date(v) -> date:
    return date.fromisoformat(str(v)[:10])


def parse_ts(v) -> Optional[datetime]:
    if v is None:
        return None
    s = str(v).replace("Z", "+00:00")
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def month_key(prefix: str, universe: str, kind: str, month: date) -> str:
    return f"{prefix}/{universe}/{kind}_{month.strftime('%Y-%m')}.parquet"


def fetch_month_streams(pg: Postgrest, universe: str, month: date) -> pa.Table:
    dates: List[date] = []
    isrcs: List[str] = []
    streams: List[int] = []
    after = ""
    while True:
        rows = pg.rpc("stream_month_export", {"p_universe": universe, "p_month": month.isoformat(), "p_after_isrc": after, "p_limit": PAGE}) or []
        if not rows:
            break
        for r in rows:
            dates.append(parse_date(r["date"]))
            isrcs.append(r["isrc"])
            streams.append(int(r["streams_cumulative"]))
        after = rows[-1]["isrc"]
        if len(rows) < PAGE and False:
            break
    return pa.table({"date": pa.array(dates, pa.date32()), "isrc": pa.array(isrcs, pa.string()),
                     "streams_cumulative": pa.array(streams, pa.int64())}, schema=STREAM_SCHEMA)


def fetch_month_overrides(pg: Postgrest, universe: str, month: date) -> pa.Table:
    rows = pg.rpc("stream_overrides_export", {"p_universe": universe, "p_month": month.isoformat()}) or []
    cols: Dict[str, list] = {f.name: [] for f in OVERRIDE_SCHEMA}
    for r in rows:
        cols["id"].append(int(r["id"]))
        cols["date"].append(parse_date(r["date"]))
        cols["isrc"].append(r["isrc"])
        cols["streams_cumulative_override"].append(int(r["streams_cumulative_override"]))
        cols["note"].append(r.get("note"))
        cols["created_by"].append(r.get("created_by"))
        cols["created_at"].append(parse_ts(r.get("created_at")))
    arrays = [pa.array(cols[f.name], f.type) for f in OVERRIDE_SCHEMA]
    return pa.Table.from_arrays(arrays, schema=OVERRIDE_SCHEMA)


def upload(s3, bucket: str, key: str, body: bytes) -> None:
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/octet-stream")


def alert(pg: Postgrest, universe: str, kind: str, subject: str, body: str) -> None:
    try:
        pg.rpc("stream_archive_alert", {"p_universe": universe, "p_kind": kind, "p_subject": subject, "p_body": body[:4000]})
    except Exception as e:  # never mask the original failure
        print(f"  could not queue alert: {e}")


# ---------------------------------------------------------------------------------------------------------
def run_smoke() -> int:
    pg = pg_client()
    s3 = r2_client()
    bucket = env("R2_BUCKET")
    cfg_bucket = (pg.rpc("stream_archive_config_get", {"p_key": "bucket"}) or "").strip()
    print(f"bucket secret == configured bucket: {cfg_bucket == bucket}")
    now = datetime(2026, 1, 2, 3, 4, 5, 678901, tzinfo=timezone.utc)
    t = pa.table({
        "d": pa.array([date(2026, 1, 1), date(2026, 12, 31), None], pa.date32()),
        "isrc": pa.array(["USAAA0000001", "USAAA0000002", None], pa.string()),
        "streams": pa.array([1, 9223372036854775000, None], pa.int64()),
        "id": pa.array([1, 2, 3], pa.int64()),
        "note": pa.array(["a", None, "ünï"], pa.string()),
        "created_at": pa.array([now, now, None], pa.timestamp("us", tz="UTC")),
        "created_by": pa.array(["123e4567-e89b-12d3-a456-426614174000", None, None], pa.string()),
        "flag": pa.array([True, False, None], pa.bool_()),
    })
    key = "v1/_selftest/smoke.parquet"
    upload(s3, bucket, key, to_parquet_bytes(t))
    print(f"uploaded {key}")
    upload(s3, bucket, "v1/_selftest/smoke.csv", ("d,isrc,streams" + NL + "2026-01-01,USAAA0000001,1" + NL + "2026-01-02,USAAA0000002,2" + NL).encode())
    upload(s3, bucket, "v1/_selftest/smoke.jsonl", ('{"d":"2026-01-01","isrc":"A","streams":1}' + NL + '{"d":"2026-01-02","isrc":"B","streams":2}' + NL).encode())
    print("uploaded smoke.csv and smoke.jsonl")
    out = pg.rpc("stream_archive_smoke", {"p_key": key})
    print(json.dumps(out, indent=1, default=str))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["smoke", "selftest", "archive"])
    args = ap.parse_args()
    if args.mode == "smoke":
        return run_smoke()
    raise SystemExit("not implemented yet")


if __name__ == "__main__":
    sys.exit(main())
