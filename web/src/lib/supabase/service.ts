import { createClient } from "@supabase/supabase-js";

import type { AppDatabase } from "./appDatabase";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export function supabaseService() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient<AppDatabase>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

