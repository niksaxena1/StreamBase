export function isSchemaMissing(err: unknown): boolean {
  const msg = String((err as any)?.message ?? "");
  // Supabase/PostgREST tends to surface missing tables/columns as these phrases.
  return msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column");
}

