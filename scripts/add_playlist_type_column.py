#!/usr/bin/env python3
"""
Add playlist_type column to playlists table if it doesn't exist.
This script should be run once to add the new column to the database.
"""

import os
import sys
from supabase import create_client, Client

def main():
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    
    if not supabase_url or not supabase_key:
        print("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        sys.exit(1)
    
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Check if column exists by trying to query it
    try:
        result = supabase.table("playlists").select("playlist_type").limit(1).execute()
        print("Column 'playlist_type' already exists")
        return
    except Exception as e:
        if "playlist_type" in str(e).lower() or "column" in str(e).lower():
            print("Column doesn't exist, adding it...")
        else:
            print(f"Unexpected error checking column: {e}")
            sys.exit(1)
    
    # Add the column using raw SQL
    # Note: This requires the service role key to have permission to execute SQL
    try:
        # Use RPC if available, otherwise we'll need to use direct SQL
        # For Supabase, we typically need to use the SQL editor or migrations
        # Let's try using the REST API to execute SQL
        print("Note: This script requires the column to be added via Supabase SQL Editor.")
        print("Please run the following SQL in your Supabase SQL Editor:")
        print()
        print("ALTER TABLE playlists ADD COLUMN IF NOT EXISTS playlist_type TEXT;")
        print()
        print("After adding the column, run the ingestion script to populate the values:")
        print("python scripts/ingest_exports_to_supabase.py")
        sys.exit(0)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
