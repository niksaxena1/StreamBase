"use client";

import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  // IMPORTANT: For client bundles, Next only inlines NEXT_PUBLIC_* when accessed statically.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) throw new Error("Missing env var: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createBrowserClient(url, anonKey);
}

