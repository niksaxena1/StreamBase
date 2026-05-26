import { normalizeDatasetMode } from "@/lib/datasetMode";
import { supabaseService } from "@/lib/supabase/service";

export type IngestionSummary = {
  latestRun: { runDate: string; status: string } | null;
  criticalWarnings: number;
};

export async function loadIngestionSummaryForUser(userId: string): Promise<IngestionSummary> {
  const svc = supabaseService();
  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode")
    .eq("user_id", userId)
    .maybeSingle();
  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);

  if (datasetMode === "competitor") {
    const comp = svc.schema("competitor");
    const { data: latestRun } = await comp
      .from("ingestion_runs")
      .select("run_date,status")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestRun?.run_date) {
      return { latestRun: null, criticalWarnings: 0 };
    }

    const runDate = String(latestRun.run_date);
    const status = String(latestRun.status ?? "unknown");
    const { count: criticalWarnings } = await comp
      .from("ingestion_warnings")
      .select("id", { count: "exact", head: true })
      .eq("run_date", runDate)
      .eq("severity", "critical");

    return {
      latestRun: { runDate, status },
      criticalWarnings: criticalWarnings ?? 0,
    };
  }

  const { data: latestRun } = await svc
    .from("ingestion_runs")
    .select("run_date,status,logs_url,finished_at")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRun?.run_date) {
    return { latestRun: null, criticalWarnings: 0 };
  }

  const runDate = String(latestRun.run_date);
  const status = String(latestRun.status ?? "unknown");
  const { count: criticalWarnings } = await svc
    .from("ingestion_warnings")
    .select("id", { count: "exact", head: true })
    .eq("run_date", runDate)
    .eq("severity", "critical");

  return {
    latestRun: { runDate, status },
    criticalWarnings: criticalWarnings ?? 0,
  };
}
