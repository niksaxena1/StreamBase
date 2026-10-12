/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * The catalog lives in a different Supabase project (schema `catalog`), reachable
 * only with the service role. Env names are server-only: never prefix with NEXT_PUBLIC_.
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

export const CATALOG_ENV_VARS = ["CATALOG_SUPABASE_URL", "CATALOG_SUPABASE_SECRET_KEY"] as const;

/** True when both env vars are set. Pages use this to show a "not connected" state instead of crashing. */
export function catalogConfigured(): boolean {
  return CATALOG_ENV_VARS.every((name) => Boolean(process.env[name]?.trim()));
}

/** Service-role client for the catalog project. Throws if the env vars are missing. */
export function catalogService() {
  const url = process.env.CATALOG_SUPABASE_URL?.trim();
  const key = process.env.CATALOG_SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error(`Missing env var: ${CATALOG_ENV_VARS.join(", ")}`);

  return createClient<CatalogDatabase>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "catalog" },
  });
}
