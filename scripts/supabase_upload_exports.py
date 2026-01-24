import argparse
import os
import time
from pathlib import Path
from typing import Iterable, Tuple

import requests


def iter_files(root: Path) -> Iterable[Path]:
    for p in root.rglob("*"):
        if p.is_file():
            yield p


def to_object_key(file_path: Path, exports_root: Path, prefix: str) -> str:
    rel = file_path.relative_to(exports_root).as_posix()
    prefix = prefix.strip()
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    return f"{prefix}{rel}"


def upload_file(
    supabase_url: str,
    service_key: str,
    bucket: str,
    object_key: str,
    file_path: Path,
) -> Tuple[bool, str]:
    # PUT /storage/v1/object/<bucket>/<object_key>
    url = f"{supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{object_key}"
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
        "x-upsert": "true",
        "Content-Type": "text/csv",
    }

    transient = {429, 500, 502, 503, 504}
    max_attempts = 5
    last_err = "unknown"

    for attempt in range(1, max_attempts + 1):
        try:
            with open(file_path, "rb") as f:
                resp = requests.put(url, headers=headers, data=f, timeout=120)

            if resp.status_code in (200, 201):
                return True, str(resp.status_code)

            # transient retry
            if resp.status_code in transient:
                last_err = f"{resp.status_code}: {resp.text[:200]}"
                sleep_s = 1.5 * attempt
                time.sleep(sleep_s)
                continue

            return False, f"{resp.status_code}: {resp.text[:300]}"
        except requests.RequestException as e:
            last_err = f"request_error:{repr(e)}"
            sleep_s = 1.5 * attempt
            time.sleep(sleep_s)
            continue

    return False, f"transient_failure_after_retries:{last_err}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exports-dir", default="exports", help="Local exports directory (default: exports)")
    ap.add_argument(
        "--bucket",
        default=os.environ.get("SUPABASE_STORAGE_BUCKET") or "spotibase-exports",
        help="Supabase Storage bucket id/name (default: spotibase-exports)",
    )
    ap.add_argument(
        "--prefix",
        default=os.environ.get("SUPABASE_STORAGE_PREFIX") or "exports",
        help="Object key prefix inside the bucket (default: exports)",
    )
    args = ap.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    bucket = (args.bucket or "spotibase-exports").strip()
    prefix = (args.prefix or "exports").strip()

    if not supabase_url or not service_key or not bucket:
        raise SystemExit(
            "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / bucket. "
            "This script is intended to run in CI with those secrets set."
        )

    exports_root = Path(args.exports_dir)
    if not exports_root.exists():
        raise SystemExit(f"Exports dir not found: {exports_root}")

    files = [p for p in iter_files(exports_root) if p.suffix.lower() == ".csv"]
    if not files:
        raise SystemExit(f"No CSV files found under {exports_root}")

    ok_count = 0
    fail_count = 0

    print(f"☁️ Uploading {len(files)} CSV(s) to Supabase Storage bucket '{bucket}' with prefix '{prefix}/'")
    for p in files:
        object_key = to_object_key(p, exports_root, prefix=prefix)
        ok, note = upload_file(
            supabase_url=supabase_url,
            service_key=service_key,
            bucket=bucket,
            object_key=object_key,
            file_path=p,
        )
        if ok:
            ok_count += 1
            print(f"✅ {object_key} ({note})")
        else:
            fail_count += 1
            print(f"❌ {object_key} ({note})")

    if fail_count:
        raise SystemExit(f"Upload finished with failures: ok={ok_count}, failed={fail_count}")

    print(f"✅ Upload complete: ok={ok_count}, failed={fail_count}")


if __name__ == "__main__":
    main()
