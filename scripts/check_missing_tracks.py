#!/usr/bin/env python3
"""
Check if the "missing" tracks are actually in the catalog stream data.
"""

import os
import requests

# ISRCs from the screenshot
missing_isrcs = [
    'GBJG25538439',  # Golden Sky
    'GBJG25538448',  # As It Was
    'GBJG25608218',  # Back To Me
    'GBJG25608322',  # Bittersweet
    'GBJG25608323',  # Pontes
    'GBJG25608423',  # Dancing In Circles
    'GBJG25608425',  # I Think I Like It
    'GBJG25608586',  # Outgrow You
]

supabase_url = os.environ.get("SUPABASE_URL", "").strip()
service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

if not supabase_url or not service_key:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    exit(1)

headers = {
    'apikey': service_key,
    'Authorization': f'Bearer {service_key}',
}

print("[*] Checking if missing tracks are in track_daily_streams for 2026-01-27...\n")

found_count = 0
missing_count = 0

for isrc in missing_isrcs:
    # Query track_daily_streams
    url = f"{supabase_url}/rest/v1/track_daily_streams?isrc=eq.{isrc}&date=eq.2026-01-27&select=isrc,date,streams"
    resp = requests.get(url, headers=headers)
    
    if resp.status_code == 200:
        data = resp.json()
        if data:
            print(f"[+] FOUND {isrc}: streams={data[0].get('streams', 'N/A')}")
            found_count += 1
        else:
            print(f"[-] MISSING {isrc}")
            missing_count += 1
    else:
        print(f"[!] ERROR querying {isrc}: {resp.status_code}")

print(f"\nSummary:")
print(f"  Found: {found_count}")
print(f"  Missing: {missing_count}")
print(f"  Total checked: {len(missing_isrcs)}")
