import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Warning codes worth tracking in the history chart (critical/warn only). */
const INTERESTING_CODES = new Set([
  "catalog_missing_stream_snapshots",
  "catalog_streams_missing_prev_nonzero",
  "stale_source_data",
  "individual_tracks_stale",
  "excluded_track_streams_zeroed",
  "total_streams_decreased",
  "track_count_swing",
  "non_catalog_tracks_present",
  "high_zero_stream_rate",
  "entity_distro_drift",
  "distro_overlap",
  "ingestion_exception",
]);

/**
 * GET /api/health-history
 *
 * Returns warning counts grouped by run_date and code for the past 30 days.
 * Only includes "interesting" warning codes (critical/warn severity).
 *
 * Reads from health_warning_history_mv (materialized view) when available,
 * falling back to the raw ingestion_warnings table.
 */
export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const svc = supabaseService();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  // Try the materialized view first; fall back to the raw table on any error
  // (e.g. if the migration hasn't been run yet).
  let rows: Array<{ run_date: string; code: string; severity: string; warning_count?: number }> | null = null;
  let usedMv = false;

  try {
    const { data: mvRows, error: mvError } = await svc
      .from("health_warning_history_mv")
      .select("run_date,code,severity,warning_count")
      .gte("run_date", thirtyDaysAgo)
      .order("run_date", { ascending: true });

    if (!mvError && mvRows) {
      rows = mvRows as typeof rows;
      usedMv = true;
    }
  } catch {
    // MV not available yet
  }

  if (!rows) {
    const { data: rawRows, error } = await svc
      .from("ingestion_warnings")
      .select("run_date,code,severity")
      .gte("run_date", thirtyDaysAgo)
      .in("severity", ["critical", "warn"])
      .order("run_date", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    rows = (rawRows ?? []) as typeof rows;
  }

  // Build date → code → count map
  const dateMap = new Map<string, Record<string, number>>();
  const allCodes = new Set<string>();

  for (const r of rows) {
    const date = String(r.run_date);
    const code = String(r.code);
    if (!INTERESTING_CODES.has(code)) continue;

    allCodes.add(code);
    if (!dateMap.has(date)) dateMap.set(date, {});
    const entry = dateMap.get(date)!;

    // When reading from the MV each row is already an aggregate; from the raw
    // table each row is one warning instance (count = 1).
    const increment = usedMv ? Number((r as { warning_count?: number }).warning_count ?? 1) : 1;
    entry[code] = (entry[code] ?? 0) + increment;
  }

  const dates = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, warnings]) => ({ date, warnings }));

  // Warning history changes at most once per daily ingestion run.
  return NextResponse.json(
    { dates, codes: Array.from(allCodes).sort() },
    { headers: { "Cache-Control": "max-age=300, stale-while-revalidate=3600" } },
  );
}
