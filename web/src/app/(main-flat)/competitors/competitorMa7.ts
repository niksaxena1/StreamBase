import type { CollectorDailyData } from "@/components/charts/CollectorComparisonChart";
import { isoDateToIsoWeekKey } from "@/components/charts/chartUtils";
import { addDaysISO } from "@/lib/sotDates";

import type { LabelDailyPoint } from "./competitorsTypes";

const MIN_DAYS = 5;

export type Ma7WeekRow = {
  labelKey: string;
  ma7Now: number | null;
  ma7Prev: number | null;
  pct: number | null;
  vsOursPts: number | null;
};

function meanOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (present.length < MIN_DAYS) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/** Trailing mean over [i-6, i] of non-null values; null when fewer than 5 are present. */
export function trailingMean7(values: Array<number | null>): Array<number | null> {
  return values.map((_, i) => meanOrNull(values.slice(Math.max(0, i - 6), i + 1)));
}

/** Replace daily_streams_net with the trailing 7 calendar-day mean, per label. */
export function smoothLabelSeriesMa7(series: LabelDailyPoint[]): LabelDailyPoint[] {
  const byLabel = new Map<string, Map<string, LabelDailyPoint>>();
  for (const point of series) {
    const m = byLabel.get(point.label_key) ?? new Map<string, LabelDailyPoint>();
    m.set(point.date, point);
    byLabel.set(point.label_key, m);
  }
  const out: LabelDailyPoint[] = [];
  for (const points of byLabel.values()) {
    const dates = [...points.keys()].sort();
    if (!dates.length) continue;
    const grid: string[] = [];
    for (let d = dates[0]; d <= dates[dates.length - 1]; d = addDaysISO(d, 1)) grid.push(d);
    const values = grid.map((d) => points.get(d)?.daily_streams_net ?? null);
    const means = trailingMean7(values);
    grid.forEach((date, i) => {
      const point = points.get(date);
      const mean = means[i];
      if (point && mean != null) out.push({ ...point, daily_streams_net: mean });
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label_key.localeCompare(b.label_key));
}

export function buildMa7WeekRows(series: LabelDailyPoint[], labelKeys: string[]): Ma7WeekRow[] {
  let latest = "";
  const lookup = new Map<string, Map<string, number>>();
  for (const point of series) {
    if (point.date > latest) latest = point.date;
    const m = lookup.get(point.label_key) ?? new Map<string, number>();
    m.set(point.date, point.daily_streams_net);
    lookup.set(point.label_key, m);
  }

  const window = (labelKey: string, endOffset: number): number | null => {
    if (!latest) return null;
    const m = lookup.get(labelKey);
    if (!m) return null;
    const vals: Array<number | null> = [];
    for (let k = 6; k >= 0; k--) vals.push(m.get(addDaysISO(latest, -(endOffset + k))) ?? null);
    return meanOrNull(vals);
  };

  const base = labelKeys.map((labelKey) => {
    const ma7Now = window(labelKey, 0);
    const ma7Prev = window(labelKey, 7);
    const pct = ma7Now != null && ma7Prev != null && ma7Prev > 0 ? (ma7Now - ma7Prev) / ma7Prev : null;
    return { labelKey, ma7Now, ma7Prev, pct };
  });
  const ownPct = base.find((r) => r.labelKey === "__own_catalog__")?.pct ?? null;
  return base.map((r) => ({
    ...r,
    vsOursPts:
      r.labelKey === "__own_catalog__" || r.pct == null || ownPct == null ? null : (r.pct - ownPct) * 100,
  }));
}

/**
 * Sum each label's daily streams into ISO weeks (Mon–Sun, keys like "2026-W44") for the comparison chart's
 * weekly view. track_count becomes the week's net track change (what the chart expects for non-daily data).
 * Part weeks at either end (series not starting on a Monday / not ending on a Sunday) are dropped so they never read as a dip.
 */
export function bucketLabelSeriesWeekly(series: LabelDailyPoint[]): CollectorDailyData[] {
  if (!series.length) return [];
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date) || a.label_key.localeCompare(b.label_key));
  const latest = sorted[sorted.length - 1].date;
  const latestWeek = isoDateToIsoWeekKey(latest);
  const latestIsSunday = new Date(`${latest}T00:00:00Z`).getUTCDay() === 0;
  const earliest = sorted[0].date;
  const earliestWeek = isoDateToIsoWeekKey(earliest);
  const earliestIsMonday = new Date(`${earliest}T00:00:00Z`).getUTCDay() === 1;
  const buckets = new Map<string, { label: string; week: string; streams: number; lastTracks: number; firstTracks: number }>();
  const lastTracksByLabel = new Map<string, number>();
  for (const p of sorted) {
    const week = isoDateToIsoWeekKey(p.date);
    if (!week || (week === latestWeek && !latestIsSunday) || (week === earliestWeek && !earliestIsMonday)) continue;
    const key = `${p.label_key}|${week}`;
    let b = buckets.get(key);
    if (!b) {
      const before = lastTracksByLabel.get(p.label_key) ?? p.track_count;
      b = { label: p.label_key, week, streams: 0, lastTracks: p.track_count, firstTracks: before };
      buckets.set(key, b);
    }
    b.streams += Number(p.daily_streams_net ?? 0);
    b.lastTracks = p.track_count;
    lastTracksByLabel.set(p.label_key, p.track_count);
  }
  return [...buckets.values()]
    .sort((a, b) => a.week.localeCompare(b.week) || a.label.localeCompare(b.label))
    .map((b) => ({
      date: b.week,
      collector: b.label,
      daily_streams_net: b.streams,
      est_revenue_daily_net: b.streams,
      track_count: b.lastTracks - b.firstTracks,
      prev_track_count: b.firstTracks,
    }));
}
