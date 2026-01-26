#!/usr/bin/env tsx
/**
 * Add playlist_type column to playlists table.
 * This script attempts to add the column using Supabase's REST API.
 * 
 * If this doesn't work, run the SQL migration file directly in Supabase SQL Editor:
 * migrations/add_playlist_type_column.sql
 */

import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Error: ${name} environment variable is required`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check if column exists
  try {
    const { data, error } = await supabase
      .from("playlists")
      .select("playlist_type")
      .limit(1);

    if (!error) {
      console.log("✓ Column 'playlist_type' already exists");
      return;
    }
  } catch (e) {
    // Column doesn't exist, continue
  }

  console.log("Column 'playlist_type' does not exist.");
  console.log("\nTo add the column, please run the following SQL in your Supabase SQL Editor:");
  console.log("\n" + "=".repeat(60));
  console.log("ALTER TABLE playlists ADD COLUMN IF NOT EXISTS playlist_type TEXT;");
  console.log("=".repeat(60));
  console.log("\nAfter adding the column, run the ingestion script to populate values:");
  console.log("python scripts/ingest_exports_to_supabase.py");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
