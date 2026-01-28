import Link from "next/link";

import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isoTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetweenUtc(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T00:00:00Z`).getTime();
  const b = new Date(`${bIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

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
  const logsUrl = (latestRun.logs_url as string | null) ?? null;

  const { count: totalWarnings } = await sb
    .from("ingestion_warnings")
    .select("id", { count: "exact", head: true })
    .eq("run_date", runDate);

  const { count: criticalWarnings } = await sb
    .from("ingestion_warnings")
    .select("id", { count: "exact", head: true })
    .eq("run_date", runDate)
    .eq("severity", "critical");

  const todayUtc = isoTodayUtc();
  const stalenessDays = daysBetweenUtc(runDate, todayUtc);
  const isStale = stalenessDays >= 1;
  const hasCritical = (criticalWarnings ?? 0) > 0;
  const hasAnyWarnings = (totalWarnings ?? 0) > 0;

  // Only show banner when it matters.
  if (status === "success" && !hasAnyWarnings && !isStale) return null;

  const tone =
    status !== "success" || hasCritical
      ? "critical"
      : isStale
        ? "warn"
        : "info";

  const className =
    tone === "critical"
      ? "mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200"
      : tone === "warn"
        ? "mb-3 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950 dark:border-orange-900/30 dark:bg-orange-900/10 dark:text-orange-200"
        : "mb-3 rounded-xl border border-blue-300 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-200";

  const headline =
    status !== "success"
      ? `Data ingestion status: ${status}`
      : hasCritical
        ? "Data integrity warning"
        : isStale
          ? "Data may be stale"
          : "Health notice";

  const details: string[] = [];
  details.push(`Latest run date (UTC): ${runDate}`);
  if (isStale) details.push(`Staleness: ${stalenessDays} day(s) behind UTC`);
  if (hasAnyWarnings) {
    details.push(
      `Warnings: ${totalWarnings ?? 0}${hasCritical ? ` (critical: ${criticalWarnings ?? 0})` : ""}`,
    );
  }

  const healthHref = `/health?date=${encodeURIComponent(runDate)}`;

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">{headline}</div>
          <div className="mt-0.5 text-xs opacity-80">{details.join(" • ")}</div>
        </div>
        <div className="flex items-center gap-3">
          <Link className="text-xs underline" href={healthHref}>
            View health
          </Link>
          {logsUrl ? (
            <a className="text-xs underline" href={logsUrl} target="_blank" rel="noreferrer">
              Open logs
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

