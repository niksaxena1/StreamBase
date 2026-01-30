import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { IngestionStatusBannerClient } from "@/components/health/IngestionStatusBannerClient";

export async function IngestionStatusBanner() {
  const sb = await supabaseServer();
  let db: typeof sb;
  try {
    // Prefer service role for reliable reads (avoids RLS/policy surprises).
    db = supabaseService() as unknown as typeof sb;
  } catch {
    db = sb;
  }

  const { data: latestRun } = await db
    .from("ingestion_runs")
    .select("id,run_date,status,logs_url,finished_at")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Initial server snapshot (keeps first paint consistent); client will poll thereafter.
  if (!latestRun?.run_date) {
    return (
      <IngestionStatusBannerClient
        initialSummary={{ latestRun: null, criticalWarnings: 0 }}
        pollMs={120_000}
      />
    );
  }

  const runDate = latestRun.run_date as string;
  const status = (latestRun.status as string | null) ?? "unknown";

  const { count: criticalWarnings } = await db
    .from("ingestion_warnings")
    .select("id", { count: "exact", head: true })
    .eq("run_date", runDate)
    .eq("severity", "critical");

  return (
    <IngestionStatusBannerClient
      initialSummary={{
        latestRun: { runDate, status },
        criticalWarnings: criticalWarnings ?? 0,
      }}
      pollMs={120_000}
    />
  );
}

