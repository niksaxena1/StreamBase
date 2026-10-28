import { redirect } from "next/navigation";

import { CACHE_TTL_1H } from "@/lib/constants";
import { hasStreamBaseAccess } from "@/lib/appAccess";
import { apiJsonErr, requireUser } from "@/lib/api/server";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

import {
  BEATPORT_TECH_HOUSE_KEY,
  type ChartDropoutRow,
  type ChartMovementRow,
  type CompareMode,
  type HistoryPoint,
} from "./chartsModel";

export type ChartsPageData = {
  chartKey: string;
  displayName: string;
  chartUrl: string;
  /** Snapshot dates, newest first. Empty until the first daily run. */
  snapshotDates: string[];
  snapshotDate: string | null;
  compareDate: string | null;
  compareDays: CompareMode;
  rows: ChartMovementRow[];
  dropouts: ChartDropoutRow[];
};

const FALLBACK_URL = "https://www.beatport.com/genre/tech-house/11/top-100";

/**
 * Charts is its own data universe (schema `charts`), independent of the own/competitor dataset
 * switch. Gate: signed in with StreamBase access (own catalog and/or competitor), then
 * service-role reads.
 */
export async function loadChartsPage(args: {
  date: string | null;
  compareDays: CompareMode;
}): Promise<ChartsPageData> {
  const { user, appAccess } = await getRequestAppContext();
  if (!user) redirect("/login");
  if (!hasStreamBaseAccess(appAccess)) redirect("/");

  const chartKey = BEATPORT_TECH_HOUSE_KEY;
  const cacheKey = `charts|${chartKey}|date:${args.date ?? "latest"}|cmp:${args.compareDays}`;

  const cached = await cachedQuery<ChartsPageData>(
    async () => {
      const ch = supabaseService().schema("charts");

      const [{ data: chartRow, error: chartErr }, { data: snapRows, error: snapErr }] = await Promise.all([
        ch.from("charts").select("display_name,url").eq("chart_key", chartKey).maybeSingle(),
        ch
          .from("snapshots")
          .select("snapshot_date")
          .eq("chart_key", chartKey)
          .order("snapshot_date", { ascending: false })
          .limit(730),
      ]);
      if (chartErr) return { data: null, error: chartErr };
      if (snapErr) return { data: null, error: snapErr };

      const snapshotDates = ((snapRows ?? []) as Array<{ snapshot_date: string }>).map((r) =>
        String(r.snapshot_date).slice(0, 10),
      );
      const base = {
        chartKey,
        displayName: (chartRow?.display_name as string | undefined) ?? "Beatport Tech House Top 100",
        chartUrl: (chartRow?.url as string | undefined) ?? FALLBACK_URL,
        snapshotDates,
        compareDays: args.compareDays,
      };
      if (snapshotDates.length === 0) {
        return {
          data: { ...base, snapshotDate: null, compareDate: null, rows: [], dropouts: [] },
          error: null,
        };
      }

      const snapshotDate = args.date && snapshotDates.includes(args.date) ? args.date : snapshotDates[0];
      const [moves, drops] = await Promise.all([
        ch.rpc("chart_movement", {
          p_chart_key: chartKey,
          p_date: snapshotDate,
          p_compare_days: args.compareDays,
        }),
        ch.rpc("chart_dropouts", {
          p_chart_key: chartKey,
          p_date: snapshotDate,
          p_compare_days: args.compareDays,
        }),
      ]);
      if (moves.error) return { data: null, error: moves.error };
      if (drops.error) return { data: null, error: drops.error };

      const rows = (moves.data ?? []) as ChartMovementRow[];
      const dropouts = (drops.data ?? []) as ChartDropoutRow[];
      const compareDate = rows[0]?.compare_date ?? dropouts[0]?.compare_date ?? null;
      return {
        data: {
          ...base,
          snapshotDate,
          compareDate: compareDate ? String(compareDate).slice(0, 10) : null,
          rows,
          dropouts,
        },
        error: null,
      };
    },
    cacheKey,
    CACHE_TTL_1H,
  );

  if (cached.error || !cached.data) {
    throw new Error(`Charts failed to load: ${cached.error?.message ?? "unknown error"}`);
  }
  return cached.data;
}

/** Position history for one track (service role; caller must already have passed the auth gate). */
export async function loadTrackChartHistory(args: {
  chartKey: string;
  source: string;
  sourceTrackId: number;
  days: number;
}): Promise<HistoryPoint[]> {
  const { data, error } = await supabaseService()
    .schema("charts")
    .rpc("track_chart_history", {
      p_chart_key: args.chartKey,
      p_source: args.source,
      p_source_track_id: args.sourceTrackId,
      p_days: args.days,
    });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ snapshot_date: string; position: number }>).map((r) => ({
    snapshot_date: String(r.snapshot_date).slice(0, 10),
    position: Number(r.position),
  }));
}

export async function requireChartsApiAccess() {
  const { sb, appAccess } = await getRequestAppContext();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth;
  if (!hasStreamBaseAccess(appAccess)) {
    return { ok: false as const, response: apiJsonErr("forbidden", 403) };
  }
  return auth;
}
