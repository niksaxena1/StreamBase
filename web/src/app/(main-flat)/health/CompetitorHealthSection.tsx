import { redirect } from "next/navigation";

import { loadCompetitorHealthPage } from "@/lib/health/competitor/loadCompetitorHealth";
import type { CompetitorHealthKpiFilter } from "@/lib/health/competitor/types";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/Alert";

import { CompetitorHealthClient } from "./CompetitorHealthClient";

function parseKpiFilter(value: string | undefined): CompetitorHealthKpiFilter {
  if (
    value === "stale" ||
    value === "mismatch" ||
    value === "missing" ||
    value === "no_export" ||
    value === "unenriched"
  ) {
    return value;
  }
  return "all";
}

export async function CompetitorHealthSection({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const getFirst = (key: string) => {
    const v = searchParams[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const warnSeverityParam = getFirst("warn_severity");
  const warningSeverity: "all" | "critical" | "warn" =
    warnSeverityParam === "critical" || warnSeverityParam === "warn"
      ? warnSeverityParam
      : "all";

  const result = await (async () => {
    try {
      const data = await loadCompetitorHealthPage({
      dataDateParam: getFirst("date") ?? null,
      labelParam: getFirst("label") ?? null,
      kpiFilter: parseKpiFilter(getFirst("filter")),
      warningPage: Math.max(1, parseInt(getFirst("page") ?? "1", 10) || 1),
      warningSeverity,
      unenrichedPage: Math.max(1, parseInt(getFirst("enrich_page") ?? "1", 10) || 1),
      userId: user.id,
      });
      return { data, error: null } as const;
    } catch (error) {
      return { data: null, error } as const;
    }
  })();

  if (!result.data) {
    return (
      <Alert variant="error" title="Query error">
        {result.error instanceof Error ? result.error.message : "Failed to load competitor health"}
      </Alert>
    );
  }

  return <CompetitorHealthClient data={result.data} />;
}
