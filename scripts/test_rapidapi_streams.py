"""
Test script for the RapidAPI Spotify Track Streams / Playback Count endpoint.

Calls the API for one or more ISRCs, prints the result, and optionally
compares with the latest value stored in Supabase track_daily_streams.

Usage:
    # Set your keys (or use a .env file)
    export RAPIDAPI_KEY="your-rapidapi-key"
    export SUPABASE_URL="https://your-project.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

    # Test with one or more ISRCs
    python scripts/test_rapidapi_streams.py GBMJG2537805 QZ4JJ1993383

    # Supabase comparison is optional — if env vars are missing it just skips.
"""

import os
import sys
import time
import json
import requests

RAPIDAPI_ENDPOINT = (
    "https://spotify-track-streams-playback-count1.p.rapidapi.com"
    "/tracks/spotify_track_streams"
)


def fetch_rapidapi_streams(isrc: str, api_key: str) -> dict:
    """Call the RapidAPI endpoint for a single ISRC. Returns the raw JSON response."""
    headers = {
        "x-rapidapi-host": "spotify-track-streams-playback-count1.p.rapidapi.com",
        "x-rapidapi-key": api_key,
    }
    params = {"isrc": isrc}
    r = requests.get(RAPIDAPI_ENDPOINT, headers=headers, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_supabase_latest(isrc: str, supabase_url: str, service_key: str) -> dict | None:
    """Fetch the most recent track_daily_streams row for this ISRC from Supabase."""
    url = (
        f"{supabase_url.rstrip('/')}/rest/v1/track_daily_streams"
        f"?isrc=eq.{isrc}&order=date.desc&limit=1"
        f"&select=date,isrc,streams_cumulative"
    )
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }
    r = requests.get(url, headers=headers, timeout=15)
    if r.status_code != 200:
        return None
    rows = r.json()
    return rows[0] if rows else None


def main():
    isrcs = [arg.strip().upper() for arg in sys.argv[1:] if arg.strip()]
    if not isrcs:
        print("Usage: python scripts/test_rapidapi_streams.py ISRC1 [ISRC2 ...]")
        sys.exit(1)

    api_key = os.environ.get("RAPIDAPI_KEY", "").strip()
    if not api_key:
        print("ERROR: Set the RAPIDAPI_KEY environment variable.")
        sys.exit(1)

    supabase_url = os.environ.get("SUPABASE_URL", "").strip()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    has_supabase = bool(supabase_url and service_key)

    if not has_supabase:
        print("(Supabase env vars not set — skipping comparison)\n")

    print(f"Testing {len(isrcs)} ISRC(s) against RapidAPI...\n")
    print("-" * 80)

    for i, isrc in enumerate(isrcs):
        if i > 0:
            # Respect free-tier rate limit: 1 request/second
            time.sleep(1.1)

        # --- RapidAPI call ---
        try:
            data = fetch_rapidapi_streams(isrc, api_key)
        except Exception as e:
            print(f"{isrc}:  API ERROR — {e}")
            continue

        result = data.get("result", "")
        api_streams = data.get("streams")
        spotify_id = data.get("spotify_track_id", "?")

        if result != "success" or api_streams is None:
            print(f"{isrc}:  API returned non-success — {json.dumps(data, indent=2)}")
            continue

        api_streams = int(api_streams)

        # --- Supabase comparison ---
        sb_label = ""
        if has_supabase:
            sb = fetch_supabase_latest(isrc, supabase_url, service_key)
            if sb:
                sb_streams = int(sb.get("streams_cumulative", 0) or 0)
                sb_date = sb.get("date", "?")
                delta = api_streams - sb_streams
                sign = "+" if delta >= 0 else ""
                match = "MATCH" if delta == 0 else f"DELTA {sign}{delta:,}"
                sb_label = f"  Supabase({sb_date})={sb_streams:>12,}  {match}"
            else:
                sb_label = "  Supabase=missing"

        print(f"{isrc}:  API={api_streams:>12,}  spotify_id={spotify_id}{sb_label}")

    print("-" * 80)
    print("Done.")


if __name__ == "__main__":
    main()
