"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { dataDateFromRunDate } from "@/lib/sotDates";

type HealthSummary = {
  latestRun: { runDate: string; status: string } | null;
  criticalWarnings: number;
};

function shouldShow(summary: HealthSummary): boolean {
  const status = summary.latestRun?.status ?? "unknown";
  // Per requirement: only show the banner while ingestion is actively running.
  return status === "running";
}

function classNameFor(summary: HealthSummary): string {
  const status = summary.latestRun?.status ?? "unknown";
  const isRunning = status === "running";

  if (isRunning) {
    return "mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-yellow-900/30 dark:bg-yellow-900/10 dark:text-yellow-200";
  }

  // Shouldn't happen if shouldShow() is correct, but keep a safe default.
  return "mb-3 rounded-xl border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-950 dark:border-yellow-900/30 dark:bg-yellow-900/10 dark:text-yellow-200";
}

function headlineFor(summary: HealthSummary): string {
  const status = summary.latestRun?.status ?? "unknown";

  if (status === "running") return "Ingestion in progress";
  // Shouldn't happen if shouldShow() is correct, but keep a safe default.
  return "Ingestion in progress";
}

export function IngestionStatusBannerClient(props: { initialSummary: HealthSummary; pollMs?: number }) {
  const pollMs = props.pollMs ?? 120_000; // default: 2 minutes
  const [summary, setSummary] = useState<HealthSummary>(props.initialSummary);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/health-summary", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as HealthSummary;
        if (!cancelled) setSummary(next);
      } catch {
        // ignore (banner is best-effort)
      }
    }

    // Poll on an interval; also run once shortly after mount to reduce stale UI.
    const t0 = window.setTimeout(tick, 1500);
    const id = window.setInterval(tick, pollMs);

    return () => {
      cancelled = true;
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, [pollMs]);

  const show = useMemo(() => shouldShow(summary), [summary]);
  if (!show) return null;

  const runDate = summary.latestRun?.runDate ?? null;
  const details: string[] = [];
  if (runDate) details.push(`Latest data date (UTC): ${dataDateFromRunDate(runDate)}`);
  if (runDate) details.push(`Ingested on (UTC): ${runDate}`);
  if ((summary.criticalWarnings ?? 0) > 0) details.push(`Critical warnings: ${summary.criticalWarnings ?? 0}`);

  const healthHref = runDate ? `/health?date=${encodeURIComponent(runDate)}` : "/health";

  return (
    <div className={classNameFor(summary)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pointer-events-none">
        <div>
          <div className="font-medium">{headlineFor(summary)}</div>
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

