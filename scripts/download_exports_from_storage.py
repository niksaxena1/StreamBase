#!/usr/bin/env python3
"""
Download export CSVs from Supabase storage to local exports/ directory.
This prepares them for re-ingestion with ingest_exports_to_supabase.py.

Usage:
    python download_exports_from_storage.py --date 2026-01-27
    python download_exports_from_storage.py --date 2026-01-27 --exports-dir exports
"""

import argparse
import os
import json
from datetime import date
from pathlib import Path
from urllib.parse import urljoin

import requests


def ymd(d: date):
    return f"{d.year:04d}", f"{d.month:02d}", f"{d.day:02d}"


def main():
    ap = argparse.ArgumentParser(
        description="Download export CSVs from Supabase storage"
    )
    ap.add_argument(
        "--date",
        required=True,
        help="Date to download exports for (YYYY-MM-DD) - use the run date, not data date",
    )
    ap.add_argument(
        "--exports-dir",
        default="exports",
        help="Local directory to save exports (default: exports)",
    )
    ap.add_argument(
        "--playlist-keys",
        default="",
        help="Comma-separated playlist keys to download (if empty, uses config/playlists.csv)",
    )
    ap.add_argument("--github-output", help="Append restored=<count> to this GitHub Actions output file")
    ap.add_argument("--authenticated", action="store_true", help="Use service-role downloads (also works for private buckets)")
    args = ap.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    storage_bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "").strip() or "spotibase-exports"
    storage_prefix = os.environ.get("SUPABASE_STORAGE_PREFIX", "").strip() or "exports"

    if not supabase_url or not service_key:
        raise SystemExit("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")

    run_date = date.fromisoformat(args.date)
    y, m, d_str = ymd(run_date)
    
    # Create local directory
    local_dir = Path(args.exports_dir) / y / m / d_str
    local_dir.mkdir(parents=True, exist_ok=True)
    
    # Get playlist keys
    if args.playlist_keys:
        playlist_keys = [k.strip() for k in args.playlist_keys.split(",") if k.strip()]
    else:
        # Try to load from config
        try:
            config_path = Path("config/playlists.csv")
            if config_path.exists():
                import csv
                playlist_keys = []
                with open(config_path, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        key = (row.get("playlist_key") or "").strip()
                        if key:
                            playlist_keys.append(key)
            else:
                print("[!] config/playlists.csv not found, specify --playlist-keys")
                return
        except Exception as e:
            print(f"[!] Error reading playlist config: {e}")
            return
    
    # Storage path for direct downloads
    storage_path = f"{storage_prefix}/{y}/{m}/{d_str}"
    
    # Direct download URL - bypassing list API
    download_url_template = urljoin(
        supabase_url.rstrip("/") + "/",
        f"storage/v1/object/{'' if args.authenticated else 'public/'}{storage_bucket}/{storage_path}/" + "{filename}"
    )
    
    print(f"[*] Downloading exports from {storage_bucket}/{storage_path}")
    print(f"[*] Saving to {local_dir}")
    
    downloaded_count = 0
    for pl_key in playlist_keys:
        file_name = f"{pl_key}.csv"
        local_file = local_dir / file_name
        file_url = download_url_template.format(filename=file_name)
        
        try:
            # Public URL by default; retries can also restore from private buckets.
            request_options = {}
            if args.authenticated:
                request_options["headers"] = {
                    "Authorization": f"Bearer {service_key}",
                    "apikey": service_key,
                }
            resp = requests.get(file_url, timeout=30, **request_options)
            
            if resp.status_code == 404:
                print(f"  [!] Not found: {file_name}")
                continue
            
            resp.raise_for_status()
            
            # Write to local file
            with open(local_file, "wb") as f:
                f.write(resp.content)
            
            lines = resp.content.count(b'\n')
            print(f"  [+] Downloaded: {file_name} ({lines} lines)")
            downloaded_count += 1
        except Exception as e:
            print(f"  [-] Error downloading {file_name}: {e}")
    
    print(f"[OK] Downloaded {downloaded_count} files to {local_dir}")
    if args.github_output:
        with open(args.github_output, "a", encoding="utf-8") as f:
            f.write(f"restored={downloaded_count}\n")


if __name__ == "__main__":
    main()
