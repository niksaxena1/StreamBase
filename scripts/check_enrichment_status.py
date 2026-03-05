#!/usr/bin/env python3
"""
Check enrichment status for a track/artist in the database.
Usage: python scripts/check_enrichment_status.py
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

import os
import requests

# Alenn - Touch Me (from user screenshot)
# ISRCs: SE62M2287950 (tables), SE62M2287960 (detail - possible typo or different track)
ISRCS_TO_CHECK = ["SE62M2287950", "SE62M2287960"]

supabase_url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

if not supabase_url or not service_key:
    print("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    exit(1)

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
}


def main():
    print("=" * 60)
    print("Enrichment status: Alenn - Touch Me")
    print("=" * 60)

    for isrc in ISRCS_TO_CHECK:
        print(f"\n--- Track ISRC: {isrc} ---")

        # Query tracks table for enrichment fields
        url = (
            f"{supabase_url}/rest/v1/tracks"
            f"?isrc=eq.{isrc}"
            f"&select=isrc,name,spotify_album_image_url,spotify_artist_ids,spotify_artist_names,spotify_track_id,spotify_last_fetched_at"
        )
        resp = requests.get(url, headers=headers, timeout=30)

        if resp.status_code != 200:
            print(f"  [!] Error querying tracks: {resp.status_code} {resp.text[:200]}")
            continue

        rows = resp.json()
        if not rows:
            print(f"  [-] Track not found in tracks table")
            continue

        r = rows[0]
        name = r.get("name") or "(no name)"
        album_img = r.get("spotify_album_image_url")
        artist_ids = r.get("spotify_artist_ids") or []
        artist_names = r.get("spotify_artist_names") or []
        track_id = r.get("spotify_track_id")
        last_fetched = r.get("spotify_last_fetched_at")

        print(f"  Name: {name}")
        print(f"  Album image URL: {'SET' if album_img else 'NULL (not enriched)'}")
        print(f"  Spotify track ID: {track_id or 'NULL'}")
        print(f"  Spotify last fetched: {last_fetched or 'never'}")
        print(f"  Artist IDs: {artist_ids}")
        print(f"  Artist names: {artist_names}")

        # Check artist images for each artist ID
        for aid, aname in zip(artist_ids, artist_names or [""] * len(artist_ids)):
            aid = aid or ""
            aname = aname or "(unknown)"
            if not aid:
                continue
            aurl = (
                f"{supabase_url}/rest/v1/spotify_artist_images"
                f"?artist_id=eq.{aid}"
                f"&select=artist_id,name,image_url,refreshed_at"
            )
            aresp = requests.get(aurl, headers=headers, timeout=30)
            if aresp.status_code == 200 and aresp.json():
                ar = aresp.json()[0]
                img = ar.get("image_url")
                print(f"  Artist '{aname}' ({aid}): image={'SET' if img else 'NULL'}, refreshed={ar.get('refreshed_at', 'N/A')}")
            else:
                print(f"  Artist '{aname}' ({aid}): NOT in spotify_artist_images cache")

    print("\n" + "=" * 60)


if __name__ == "__main__":
    main()
