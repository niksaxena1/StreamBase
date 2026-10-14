"use client";

import { useEffect, useMemo, useState } from "react";

import { computeDailyRollingAvg7, dailyFromCumulativeAsc } from "@/components/charts/chartUtils";
import { fetchApiJson } from "@/lib/api";

export type OlderArtistHistoryTarget = { artistId: string; startRunDate: string; endRunDate: string };
type CumPoint = { date: string; value: number };
type DailyPoint = { date: string; daily: number | null; ma7?: number | null };
type OlderRow = { date: string; streams_cumulative: number | null };

/**
 * Join the older (progressively loaded) artist cumulative rows onto the recent ones and recompute daily values and
 * MA7 across the seam. Dates are run dates. Output matches what the server produces for a single-shot load.
 */
export function mergeOlderArtistSeries(args: {
  recentCumAsc: CumPoint[];
  recentDailyDesc: DailyPoint[];
  olderRows: OlderRow[] | null;
  startRunDate: string;
}): { cumAsc: CumPoint[]; dailyDesc: DailyPoint[] } {
  const { recentCumAsc, recentDailyDesc, olderRows, startRunDate } = args;
  if (!olderRows || olderRows.length === 0) return { cumAsc: recentCumAsc, dailyDesc: recentDailyDesc };
  const firstRecent = recentCumAsc.length ? recentCumAsc[0].date : null;
  const older = olderRows
    .filter((r) => (firstRecent ? r.date < firstRecent : true))
    .map((r) => ({ date: r.date, value: Number(r.streams_cumulative ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const fullAsc = [...older, ...recentCumAsc];
  const dailyDescFull = [...dailyFromCumulativeAsc(fullAsc)].reverse();
  const dailyDesc = computeDailyRollingAvg7(dailyDescFull).filter((p) => p.date >= startRunDate);
  return { cumAsc: fullAsc.filter((p) => p.date >= startRunDate), dailyDesc };
}

/** Fetch the older part of an artist's All-history series once the recent year has rendered. */
export function useOlderArtistHistory(target: OlderArtistHistoryTarget | null | undefined) {
  const key = target ? `${target.artistId}|${target.startRunDate}|${target.endRunDate}` : null;
  const [state, setState] = useState<{ key: string | null; rows: OlderRow[] | null; failed: boolean }>({
    key: null,
    rows: null,
    failed: false,
  });

  useEffect(() => {
    if (!target || !key) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      artist_id: target.artistId,
      start: target.startRunDate,
      end: target.endRunDate,
    });
    fetchApiJson<{ rows: OlderRow[] }>(`/api/catalog/artist-history?${params.toString()}`, { signal: controller.signal })
      .then((data) => setState({ key, rows: data.rows ?? [], failed: false }))
      .catch((error) => {
        if (controller.signal.aborted || (error as { name?: string })?.name === "AbortError") return;
        setState({ key, rows: null, failed: true });
      });
    return () => controller.abort();
    // `key` captures every field of `target` that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    if (!key) return { loading: false, failed: false, rows: null as OlderRow[] | null };
    if (state.key !== key) return { loading: true, failed: false, rows: null as OlderRow[] | null };
    return { loading: false, failed: state.failed, rows: state.rows };
  }, [key, state]);
}
