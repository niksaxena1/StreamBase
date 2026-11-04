/** Pure logic for the per-track stream chart on the upload tracks page. */

export type HistorySnapshot = { date: string; playcount: number };

export type HistoryMembership = {
  added_at: string | null;
  first_seen_date: string | null;
  removed_date: string | null;
};

export type TrackHistory = {
  track_id: string;
  snapshots: HistorySnapshot[];
  membership: HistoryMembership | null;
};

export type HistoryRange = "7d" | "28d" | "90d" | "all";
export const HISTORY_RANGES: HistoryRange[] = ["7d", "28d", "90d", "all"];

/** One chart point. `days` is how many calendar days the gain covers (>1 across a gap in snapshots). */
export type DailyGainPoint = { date: string; gain: number; days: number };

export type ChartPoint = {
  date: string;
  value: number | null;
  _bucketDays?: number;
};

export type HistoryStats = {
  streamsSinceAdded: number;
  avgPerDay: number | null;
  bestDay: { date: string; value: number } | null;
  daysTracked: number;
};

const DAY_MS = 86_400_000;

export function isoDay(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
}

export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Sorted ascending, one entry per date (last write wins), invalid rows dropped. */
export function normalizeSnapshots(raw: unknown): HistorySnapshot[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, number>();
  for (const item of raw) {
    const rec = item as { date?: unknown; playcount?: unknown } | null;
    const date = isoDay(typeof rec?.date === "string" ? rec.date : null);
    if (date === null || rec?.playcount === null || rec?.playcount === undefined) continue;
    const playcount = Number(rec.playcount);
    if (!Number.isFinite(playcount)) continue;
    byDate.set(date, playcount);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, playcount]) => ({ date, playcount }));
}

/** Playcount difference between consecutive snapshot dates, tagged with the number of days it spans. */
export function dailyGainPoints(snapshots: HistorySnapshot[]): DailyGainPoint[] {
  const out: DailyGainPoint[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const days = Math.max(1, diffDays(snapshots[i - 1].date, snapshots[i].date));
    out.push({ date: snapshots[i].date, gain: snapshots[i].playcount - snapshots[i - 1].playcount, days });
  }
  return out;
}

/** First visible date for a range, anchored on the newest date (inclusive: 7d shows 7 calendar days). */
export function rangeStart(lastDate: string | null, range: HistoryRange): string | null {
  if (!lastDate || range === "all") return null;
  const n = range === "7d" ? 7 : range === "28d" ? 28 : 90;
  return addDays(lastDate, -(n - 1));
}

export function filterByRange<T extends { date: string }>(items: T[], range: HistoryRange): T[] {
  if (items.length === 0) return items;
  const start = rangeStart(items[items.length - 1].date, range);
  return start === null ? items : items.filter((p) => p.date >= start);
}

/** Chart rows newest-first, which is the order DailyStreamsChart expects. */
export function buildChartData(snapshots: HistorySnapshot[], mode: "daily" | "total", range: HistoryRange): ChartPoint[] {
  const asc: ChartPoint[] =
    mode === "total"
      ? filterByRange(snapshots, range).map((s) => ({ date: s.date, value: s.playcount }))
      : filterByRange(dailyGainPoints(snapshots), range).map((p) => ({
          date: p.date,
          value: p.gain,
          ...(p.days > 1 ? { _bucketDays: p.days } : {}),
        }));
  return asc.reverse();
}

/** Marker date snapped to the first chart date on/after it; null when outside the visible dates. */
export function snapMarkerDate(dateIso: string | null, chartDates: string[]): string | null {
  if (!dateIso || chartDates.length === 0) return null;
  const sorted = [...chartDates].sort();
  if (dateIso > sorted[sorted.length - 1]) return null;
  if (dateIso < sorted[0]) return null;
  return sorted.find((d) => d >= dateIso) ?? null;
}

export function addedDateOf(m: HistoryMembership | null): string | null {
  return isoDay(m?.added_at) ?? isoDay(m?.first_seen_date);
}

export function computeStats(snapshots: HistorySnapshot[], membership: HistoryMembership | null): HistoryStats | null {
  if (snapshots.length < 2) return null;
  const latest = snapshots[snapshots.length - 1];
  const from = isoDay(membership?.first_seen_date) ?? addedDateOf(membership);
  const base = (from ? snapshots.find((s) => s.date >= from) : null) ?? snapshots[0];
  const streamsSinceAdded = latest.playcount - base.playcount;
  const spanDays = diffDays(base.date, latest.date);
  let bestDay: HistoryStats["bestDay"] = null;
  for (const p of dailyGainPoints(snapshots)) {
    if (p.days !== 1) continue; // a gap covers several days; not a single "day"
    if (bestDay === null || p.gain > bestDay.value) bestDay = { date: p.date, value: p.gain };
  }
  return {
    streamsSinceAdded,
    avgPerDay: spanDays > 0 ? streamsSinceAdded / spanDays : null,
    bestDay,
    daysTracked: snapshots.length,
  };
}

/** First snapshot date when the track was in the playlist before it, else null. */
export function trackingStartedNote(snapshots: HistorySnapshot[], membership: HistoryMembership | null): string | null {
  const added = addedDateOf(membership);
  if (snapshots.length === 0 || !added) return null;
  return added < snapshots[0].date ? snapshots[0].date : null;
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic fake history for development: ~45 daily snapshots ending at `latestPlaycount` on
 * `lastDate`, with the track "added" `addedDaysAgo` days before and a decaying bump after it.
 */
export function generateDemoHistory(opts: {
  trackId: string;
  latestPlaycount: number | null;
  lastDate: string;
  removedDate?: string | null;
  days?: number;
  addedDaysAgo?: number;
}): TrackHistory {
  const days = Math.max(3, opts.days ?? 45);
  const addedDaysAgo = Math.min(opts.addedDaysAgo ?? 20, days - 2);
  const latest = Math.max(1000, Math.round(opts.latestPlaycount ?? 25_000));
  const rand = mulberry32(hash32(opts.trackId));
  const addedIdx = days - 1 - addedDaysAgo; // index of the added day in the series

  const weights: number[] = [];
  for (let i = 1; i < days; i++) {
    const noise = 0.75 + rand() * 0.5;
    const sinceAdd = i - addedIdx;
    const bump = sinceAdd >= 0 ? 1 + 6 * Math.exp(-sinceAdd / 5) : 1;
    weights.push(noise * bump);
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const totalGain = Math.round(latest * 0.7);
  const gains = weights.map((w) => Math.max(1, Math.round((w / totalWeight) * totalGain)));
  const start = Math.max(0, latest - gains.reduce((a, b) => a + b, 0));

  const firstDate = addDays(opts.lastDate, -(days - 1));
  const snapshots: HistorySnapshot[] = [{ date: firstDate, playcount: start }];
  let running = start;
  gains.forEach((g, idx) => {
    running += g;
    snapshots.push({ date: addDays(firstDate, idx + 1), playcount: running });
  });
  snapshots[snapshots.length - 1].playcount = latest;

  const addedDate = addDays(opts.lastDate, -addedDaysAgo);
  return {
    track_id: opts.trackId,
    snapshots,
    membership: {
      added_at: `${addedDate}T12:00:00+00:00`,
      first_seen_date: addedDate,
      removed_date: opts.removedDate ?? null,
    },
  };
}
