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

  const { data: rows, error } = await svc
    .from("ingestion_warnings")
    .select("run_date,code,severity")
    .gte("run_date", thirtyDaysAgo)
    .in("severity", ["critical", "warn"])
    .order("run_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Group by date and code
  const dateMap = new Map<string, Record<string, number>>();
  const allCodes = new Set<string>();

  for (const r of (rows ?? []) as any[]) {
    const date = String(r.run_date);
    const code = String(r.code);
    if (!INTERESTING_CODES.has(code)) continue;

    allCodes.add(code);
    if (!dateMap.has(date)) dateMap.set(date, {});
    const entry = dateMap.get(date)!;
    entry[code] = (entry[code] ?? 0) + 1;
  }

  // Build sorted date array
  const dates = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, warnings]) => ({ date, warnings }));

  return NextResponse.json({
    dates,
    codes: Array.from(allCodes).sort(),
  });
}
