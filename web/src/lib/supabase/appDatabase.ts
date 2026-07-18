/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Database as GeneratedDatabase } from "./database.types";

export type { Json } from "./database.types";

/**
 * The Supabase MCP type generator only emits the `public` schema, so the
 * `competitor` and `playlist_watch` schemas get permissive placeholder shapes:
 * `.schema("competitor").from(...)/.rpc(...)` compiles with `any` rows, which
 * preserves the pre-typed-client behaviour at those call sites. Replace the
 * loose schemas with real generated ones when types are regenerated via
 * `supabase gen types typescript --schema public,competitor,playlist_watch`.
 */
type LooseSchema = {
  Tables: Record<string, { Row: any; Insert: any; Update: any; Relationships: [] }>;
  Views: Record<string, { Row: any }>;
  Functions: Record<string, { Args: any; Returns: any }>;
  Enums: Record<string, never>;
  CompositeTypes: Record<string, never>;
};

export type AppDatabase = {
  __InternalSupabase: GeneratedDatabase["__InternalSupabase"];
  public: GeneratedDatabase["public"];
  competitor: LooseSchema;
  playlist_watch: LooseSchema;
};

/** Row type for a public-schema table, e.g. `TableRow<"tracks">`. */
export type TableRow<T extends keyof GeneratedDatabase["public"]["Tables"]> =
  GeneratedDatabase["public"]["Tables"][T]["Row"];

/** Row type for a public-schema view, e.g. `ViewRow<"collector_daily_agg">`. */
export type ViewRow<T extends keyof GeneratedDatabase["public"]["Views"]> =
  GeneratedDatabase["public"]["Views"][T]["Row"];

/** Insert payload type for a public-schema table, e.g. `TableInsert<"user_settings">`. */
export type TableInsert<T extends keyof GeneratedDatabase["public"]["Tables"]> =
  GeneratedDatabase["public"]["Tables"][T]["Insert"];
