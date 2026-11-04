export type GrowthWindow = "1d" | "7d" | "28d" | "added";
export type GrowthMetric = "abs" | "pct";
export type UploadSortKey = "track" | "streams" | "growth" | "added";
export type SortDir = "asc" | "desc";

export const GROWTH_WINDOWS: GrowthWindow[] = ["1d", "7d", "28d", "added"];

export type UploadTrackRow = {
  spotifyTrackId: string;
  name: string;
  artists: string;
  imageUrl: string | null;
  /** ISO date (yyyy-mm-dd) shown as the added date: Spotify added_at, else first_seen_date. */
  addedDate: string | null;
  removedDate: string | null;
  latestDate: string | null;
  latestPlaycount: number | null;
  playcount1d: number | null;
  playcount7d: number | null;
  playcount28d: number | null;
  playcountAtAdd: number | null;
  history: [string, number][];
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  return value.slice(0, 10);
}

export function normalizeHistory(raw: unknown): [string, number][] {
  if (!Array.isArray(raw)) return [];
  const out: [string, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const date = dateOnly(item[0]);
    const count = num(item[1]);
    if (date === null || count === null) continue;
    out.push([date, count]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

export function normalizeRow(raw: Record<string, unknown>): UploadTrackRow {
  return {
    spotifyTrackId: String(raw.spotify_track_id ?? ""),
    name: String(raw.name ?? raw.spotify_track_id ?? ""),
    artists: String(raw.artists ?? ""),
    imageUrl: typeof raw.image_url === "string" && raw.image_url ? raw.image_url : null,
    addedDate: dateOnly(raw.added_at) ?? dateOnly(raw.first_seen_date),
    removedDate: dateOnly(raw.removed_date),
    latestDate: dateOnly(raw.latest_date),
    latestPlaycount: num(raw.latest_playcount),
    playcount1d: num(raw.playcount_1d),
    playcount7d: num(raw.playcount_7d),
    playcount28d: num(raw.playcount_28d),
    playcountAtAdd: num(raw.playcount_at_add),
    history: normalizeHistory(raw.history),
  };
}

export function normalizeRows(raw: unknown): UploadTrackRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => normalizeRow(r as Record<string, unknown>));
}

export function baselineFor(row: UploadTrackRow, window: GrowthWindow): number | null {
  switch (window) {
    case "1d":
      return row.playcount1d;
    case "7d":
      return row.playcount7d;
    case "28d":
      return row.playcount28d;
    case "added":
      return row.playcountAtAdd;
  }
}

/** Latest playcount minus the window baseline; null when either side is missing. */
export function growthFor(row: UploadTrackRow, window: GrowthWindow): number | null {
  const baseline = baselineFor(row, window);
  if (row.latestPlaycount === null || baseline === null) return null;
  return row.latestPlaycount - baseline;
}

/** Growth as a percent of the baseline; null when the baseline is missing or zero. */
export function growthPercentFor(row: UploadTrackRow, window: GrowthWindow): number | null {
  const growth = growthFor(row, window);
  const baseline = baselineFor(row, window);
  if (growth === null || baseline === null || baseline <= 0) return null;
  return (growth / baseline) * 100;
}

export function formatPercent(value: number | null): string {
  if (value === null) return "-";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** Differences between consecutive history points (value on the later date). */
export function dailyGains(history: [string, number][]): number[] {
  const gains: number[] = [];
  for (let i = 1; i < history.length; i++) gains.push(history[i][1] - history[i - 1][1]);
  return gains;
}

export function isNewlyAdded(addedDate: string | null, today: string, days = 7): boolean {
  if (!addedDate) return false;
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${addedDate}T00:00:00Z`);
  return Number.isFinite(ms) && ms >= 0 && ms <= days * 86_400_000;
}

export function splitRemoved(rows: UploadTrackRow[]): { current: UploadTrackRow[]; removed: UploadTrackRow[] } {
  const current: UploadTrackRow[] = [];
  const removed: UploadTrackRow[] = [];
  for (const row of rows) (row.removedDate ? removed : current).push(row);
  return { current, removed };
}

function compareNullable(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls always last
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export function sortRows(
  rows: UploadTrackRow[],
  key: UploadSortKey,
  dir: SortDir,
  window: GrowthWindow,
  metric: GrowthMetric,
): UploadTrackRow[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let c = 0;
    if (key === "track") c = mult * a.name.localeCompare(b.name);
    else if (key === "streams") c = compareNullable(a.latestPlaycount, b.latestPlaycount, dir);
    else if (key === "growth") {
      const get = (r: UploadTrackRow) => (metric === "pct" ? growthPercentFor(r, window) : growthFor(r, window));
      c = compareNullable(get(a), get(b), dir);
      // Ties (and the first days, when growth is still null for every row) rank by total streams.
      if (c === 0) c = compareNullable(a.latestPlaycount, b.latestPlaycount, "desc");
    } else {
      const ad = a.addedDate;
      const bd = b.addedDate;
      if (ad === null || bd === null) c = ad === bd ? 0 : ad === null ? 1 : -1;
      else c = mult * ad.localeCompare(bd);
    }
    return c !== 0 ? c : a.name.localeCompare(b.name);
  });
}

export function filterRows(rows: UploadTrackRow[], query: string): UploadTrackRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.artists.toLowerCase().includes(q));
}

export type UploadSummary = {
  trackCount: number;
  totalStreams: number;
  windowGrowth: number | null;
  topGainer: { row: UploadTrackRow; growth: number } | null;
};

export function summarize(current: UploadTrackRow[], window: GrowthWindow): UploadSummary {
  let totalStreams = 0;
  let windowGrowth: number | null = null;
  let topGainer: UploadSummary["topGainer"] = null;
  for (const row of current) {
    totalStreams += row.latestPlaycount ?? 0;
    const g = growthFor(row, window);
    if (g === null) continue;
    windowGrowth = (windowGrowth ?? 0) + g;
    if (g > 0 && (topGainer === null || g > topGainer.growth)) topGainer = { row, growth: g };
  }
  return { trackCount: current.length, totalStreams, windowGrowth, topGainer };
}

export function parseWindow(value: string | null | undefined): GrowthWindow {
  return value === "1d" || value === "28d" || value === "added" || value === "7d" ? value : "7d";
}

export function parseMetric(value: string | null | undefined): GrowthMetric {
  return value === "pct" ? "pct" : "abs";
}
