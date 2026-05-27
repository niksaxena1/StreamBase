import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { dataDateFromRunDate } from "@/lib/sotDates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const comp = svc.schema("competitor");
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  type HistoryRow = { run_date: string; code: string; severity: string; warning_count?: number };
  let rows: HistoryRow[] = [];
  let usedMv = false;

  try {
    const { data: mvRows, error: mvError } = await comp
      .from("health_warning_history_mv")
      .select("run_date,code,severity,warning_count")
      .gte("run_date", thirtyDaysAgo)
      .order("run_date", { ascending: true });

    if (!mvError && mvRows) {
      rows = mvRows as HistoryRow[];
      usedMv = true;
    }
  } catch {
    // MV not available
  }

  if (!rows.length) {
    const { data: rawRows, error } = await comp
      .from("ingestion_warnings")
      .select("run_date,code,severity")
      .gte("run_date", thirtyDaysAgo)
      .in("severity", ["critical", "warn"])
      .order("run_date", { ascending: true });

    if (error) return apiJsonErr(error.message, 500);
    rows = (rawRows ?? []) as HistoryRow[];
  }

  const { data: runRows } = await comp
    .from("ingestion_runs")
    .select("run_date")
    .gte("run_date", thirtyDaysAgo)
    .order("run_date", { ascending: true });

  const dateMap = new Map<string, Record<string, number>>();
  const allCodes = new Set<string>();

  for (const r of runRows ?? []) {
    const date = String((r as { run_date?: unknown }).run_date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !dateMap.has(date)) {
      dateMap.set(date, {});
    }
  }

  for (const r of rows) {
    const date = String(r.run_date).slice(0, 10);
    const code = String(r.code);
    if (!dateMap.has(date)) dateMap.set(date, {});
    allCodes.add(code);
    const entry = dateMap.get(date)!;
    const increment = usedMv ? Number(r.warning_count ?? 1) : 1;
    entry[code] = (entry[code] ?? 0) + increment;
  }

  const dates = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, warnings]) => ({
      date,
      data_date: dataDateFromRunDate(date),
      warnings,
      detected: Object.values(warnings).reduce((sum, n) => sum + Number(n ?? 0), 0),
    }));

  return apiJsonOk(
    { dates, codes: Array.from(allCodes).sort() },
    { headers: { "Cache-Control": "max-age=300, stale-while-revalidate=3600" } },
  );
}
