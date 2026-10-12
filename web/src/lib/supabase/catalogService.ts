/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * The label catalog lives in this project's `catalog` schema, reachable through the
 * Data API with the service role only (anon/authenticated have no grants).
 * Typed loosely, like the `competitor` schema in appDatabase.ts.
 */
type LooseSchema = {
  Tables: Record<string, { Row: any; Insert: any; Update: any; Relationships: [] }>;
  Views: Record<string, { Row: any }>;
  Functions: Record<string, { Args: any; Returns: any }>;
  Enums: Record<string, never>;
  CompositeTypes: Record<string, never>;
};

export type CatalogDatabase = { catalog: LooseSchema };

/** Same env as `supabaseService()`; the service key is server-only. */
export const CATALOG_ENV_VARS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** True when both env vars are set. Pages use this to show a "not connected" state instead of crashing. */
export function catalogConfigured(): boolean {
  return CATALOG_ENV_VARS.every((name) => Boolean(process.env[name]?.trim()));
}

/** Service-role client scoped to the `catalog` schema. Throws if the env vars are missing. */
export function catalogService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error(`Missing env var: ${CATALOG_ENV_VARS.join(", ")}`);

  return createClient<CatalogDatabase>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "catalog" },
  });
}
