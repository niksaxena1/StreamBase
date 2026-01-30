import Link from "next/link";

import { supabaseServer } from "@/lib/supabase/server";
import { dataDateFromRunDate } from "@/lib/sotDates";

export const revalidate = 30; // 30s ISR - refresh frequently to catch running ingestions

export async function IngestionStatusBanner() {
  const sb = await supabaseServer();

  const { data: latestRun } = await sb
    .from("ingestion_runs")
    .select("id,run_date,status,logs_url,finished_at")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRun?.run_date) return null;

  const runDate = latestRun.run_date as string;
  const status = (latestRun.status as string | null) ?? "unknown";

  const { count: criticalWarnings } = await sb
    .from("ingestion_warnings")
    .select("id", { count: "exact", head: true })
    .eq("run_date", runDate)
    .eq("severity", "critical");

  const hasCritical = (criticalWarnings ?? 0) > 0;
  const isRunning = status === "running";

  // Only show banner when it matters: running, failed, or has critical warnings.
  if (status === "success" && !hasCritical && !isRunning) return null;

  const className =
    status === "running"
      ? "mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-yellow-900/30 dark:bg-yellow-900/10 dark:text-yellow-200"
      : "mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200";

  const headline =
    status === "running"
      ? "Ingestion in progress"
      : status !== "success"
        ? `Data ingestion status: ${status}`
        : "Critical health warning";

  const details: string[] = [];
  details.push(`Latest data date (UTC): ${dataDateFromRunDate(runDate)}`);
  details.push(`Ingested on (UTC): ${runDate}`);
  if (hasCritical) details.push(`Critical warnings: ${criticalWarnings ?? 0}`);

  const healthHref = `/health?date=${encodeURIComponent(runDate)}`;

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pointer-events-none">
        <div>
          <div className="font-medium">{headline}</div>
          <div className="mt-0.5 text-xs opacity-80">{details.join(" • ")}</div>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          <Link className="text-xs underline" href={healthHref}>
            View health
          </Link>
        </div>
      </div>
    </div>
  );
}

