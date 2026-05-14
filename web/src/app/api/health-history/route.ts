import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";
import { getActiveWarningSummary } from "@/lib/health/activeWarnings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  type HistoryRow = { run_date: string; code: string; severity: string; warning_count?: number };
  let rows: HistoryRow[] | null = null;
  let usedMv = false;

  try {
    const { data: mvRows, error: mvError } = await svc
      .from("health_warning_history_mv")
      .select("run_date,code,severity,warning_count")
      .gte("run_date", thirtyDaysAgo)
      .order("run_date", { ascending: true });

    if (!mvError && mvRows) {
      rows = mvRows as unknown as HistoryRow[];
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
      return apiJsonErr(error.message, 500);
    }
    rows = (rawRows ?? []) as HistoryRow[];
  }

  const dateMap = new Map<string, Record<string, number>>();
  const allCodes = new Set<string>();

  for (const r of rows) {
    const date = String(r.run_date);
    const code = String(r.code);
    if (!INTERESTING_CODES.has(code)) continue;

    allCodes.add(code);
    if (!dateMap.has(date)) dateMap.set(date, {});
    const entry = dateMap.get(date)!;

    const increment = usedMv ? Number((r as { warning_count?: number }).warning_count ?? 1) : 1;
    entry[code] = (entry[code] ?? 0) + increment;
  }

  const dates = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, warnings]) => ({ date, warnings }));

  const activeByDate = new Map<string, number>();
  await Promise.all(
    dates.map(async ({ date }) => {
      const summary = await getActiveWarningSummary(date);
      activeByDate.set(date, summary.criticalCount + summary.warnCount);
    }),
  );

  return apiJsonOk(
    {
      dates: dates.map((entry) => {
        const detected = Object.values(entry.warnings).reduce((sum, n) => sum + Number(n ?? 0), 0);
        const active = Math.min(activeByDate.get(entry.date) ?? detected, detected);
        return {
          ...entry,
          detected,
          active,
          resolved: Math.max(0, detected - active),
        };
      }),
      codes: Array.from(allCodes).sort(),
    },
    { headers: { "Cache-Control": "max-age=300, stale-while-revalidate=3600" } },
  );
}
