import type { CollectorDailyData } from "@/components/charts/CollectorComparisonChart";
import { filterDailySeriesFromIsoDate } from "@/components/charts/chartUtils";

import type { LabelDailyPoint, LabelRow } from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

export function labelSeriesToCollectorDailyData(rows: LabelDailyPoint[]): CollectorDailyData[] {
  const sorted = [...rows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.label_key.localeCompare(b.label_key),
  );
  const prevTrackByLabel = new Map<string, number>();
  const out: CollectorDailyData[] = [];

  for (const row of sorted) {
    const prev = prevTrackByLabel.get(row.label_key) ?? row.track_count;
    out.push({
      date: row.date,
      collector: row.label_key,
      daily_streams_net: row.daily_streams_net,
      est_revenue_daily_net: row.daily_streams_net,
      track_count: row.track_count,
      prev_track_count: prev,
    });
    prevTrackByLabel.set(row.label_key, row.track_count);
  }

  return out;
}

export function buildSeriesColorMap(labels: LabelRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  labels.forEach((label, index) => {
    map[label.label_key] = labelColor(label, index);
  });
  return map;
}

export function buildSeriesLabelMap(labels: LabelRow[]): Record<string, string> {
  return Object.fromEntries(labels.map((l) => [l.label_key, l.display_name]));
}

export function buildSparkByLabel(
  labelSeries: LabelDailyPoint[],
  chartStartDateIso: string | null | undefined,
  streamPayoutPerStreamUsd: number,
): Map<string, { streams: number[] | null; revenue: number[] | null; tracks: number[] | null }> {
  const filtered = filterDailySeriesFromIsoDate(
    labelSeriesToCollectorDailyData(labelSeries),
    chartStartDateIso,
  );

  const byLabel = new Map<string, CollectorDailyData[]>();
  for (const row of filtered) {
    const key = String(row.collector ?? "").trim();
    if (!key) continue;
    const arr = byLabel.get(key) ?? [];
    arr.push(row);
    byLabel.set(key, arr);
  }

  for (const [key, arr] of byLabel) {
    arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    byLabel.set(key, arr);
  }

  const takeLast = (arr: number[]) => (arr.length > 30 ? arr.slice(arr.length - 30) : arr);

  const build = (labelKey: string) => {
    const rows = byLabel.get(labelKey) ?? [];
    if (!rows.length) {
      return { streams: null as number[] | null, revenue: null as number[] | null, tracks: null as number[] | null };
    }

    const streams = rows.map((r) => Number(r.daily_streams_net ?? 0)).filter((n) => Number.isFinite(n));
    const revenue = streams.map((n) => n * streamPayoutPerStreamUsd);
    const tracksDelta: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cur = Number(rows[i].track_count ?? 0);
      const prev = Number(rows[i - 1].track_count ?? 0);
      tracksDelta.push(Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : 0);
    }

    return {
      streams: takeLast(streams),
      revenue: takeLast(revenue),
      tracks: takeLast(tracksDelta),
    };
  };

  const out = new Map<string, { streams: number[] | null; revenue: number[] | null; tracks: number[] | null }>();
  for (const key of byLabel.keys()) {
    out.set(key, build(key));
  }
  return out;
}
