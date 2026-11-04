export type GrowthWindow = "fri" | "1d" | "7d" | "28d" | "added";
export type GrowthMetric = "abs" | "pct";
export type UploadSortKey = "track" | "streams" | "growth" | "added" | "beatport";
export type SortDir = "asc" | "desc";

export const GROWTH_WINDOWS: GrowthWindow[] = ["fri", "1d", "7d", "28d", "added"];

export type UploadTrackRow = {
  spotifyTrackId: string;
  name: string;
  artists: string;
  imageUrl: string | null;
  /** ISO date (yyyy-mm-dd) shown as the added date: Spotify added_at, else first_seen_date. */
  addedDate: string | null;
  removedDate: string | null;
  /** Raw Spotify release_date: yyyy-mm-dd, or only yyyy / yyyy-mm (treated as old). */
  releaseDate: string | null;
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
    releaseDate: typeof raw.release_date === "string" && raw.release_date ? raw.release_date : null,
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

const DAY_MS = 86_400_000;

/** Latest snapshot date across a row set (yyyy-mm-dd), or null when nothing is collected yet. */
export function latestSnapshotDateOf(rows: UploadTrackRow[]): string | null {
  let latest: string | null = null;
  for (const r of rows) if (r.latestDate && (latest === null || r.latestDate > latest)) latest = r.latestDate;
  return latest;
}

/**
 * The most recent Friday strictly before `latestDate`: a Saturday snapshot gives yesterday,
 * a Friday snapshot gives the Friday a week earlier. Null when there is no snapshot yet.
 */
export function referenceFriday(latestDate: string | null): string | null {
  if (!latestDate) return null;
  const ms = Date.parse(`${latestDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const dow = new Date(ms).getUTCDay(); // 0 Sun .. 5 Fri .. 6 Sat
  const back = (dow - 5 + 7) % 7 || 7;
  return new Date(ms - back * DAY_MS).toISOString().slice(0, 10);
}

/** "Fri 31 Oct" for a reference Friday (yyyy-mm-dd). */
export function formatFridayLabel(refFriday: string | null): string {
  if (!refFriday) return "Fri";
  const d = new Date(`${refFriday}T12:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "Fri";
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `Fri ${d.getUTCDate()} ${month}`;
}

/** True only for a full yyyy-mm-dd release date on/after the reference Friday. */
export function isReleasedSince(releaseDate: string | null, refFriday: string | null): boolean {
  if (!releaseDate || !refFriday || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return false;
  return releaseDate >= refFriday;
}

/**
 * Baseline for "Since Fri": 0 for a release on/after that Friday, else the latest history point
 * on or before it, else the first point after it, else null.
 */
export function fridayBaseline(row: UploadTrackRow, refFriday: string | null): number | null {
  if (!refFriday) return null;
  if (isReleasedSince(row.releaseDate, refFriday)) return 0;
  let onOrBefore: number | null = null;
  for (const [date, count] of row.history) {
    if (date <= refFriday) onOrBefore = count;
    // First point after Friday only counts as a baseline if it is older than the latest point;
    // otherwise growth would read +0 when there is simply no history yet.
    else return onOrBefore ?? (row.latestDate !== null && date < row.latestDate ? count : null);
  }
  return onOrBefore;
}

export function baselineFor(row: UploadTrackRow, window: GrowthWindow, refFriday: string | null = null): number | null {
  switch (window) {
    case "fri":
      return fridayBaseline(row, refFriday);
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
export function growthFor(row: UploadTrackRow, window: GrowthWindow, refFriday: string | null = null): number | null {
  const baseline = baselineFor(row, window, refFriday);
  if (row.latestPlaycount === null || baseline === null) return null;
  return row.latestPlaycount - baseline;
}

/** Growth as a percent of the baseline; null when the baseline is missing or zero. */
export function growthPercentFor(row: UploadTrackRow, window: GrowthWindow, refFriday: string | null = null): number | null {
  const growth = growthFor(row, window, refFriday);
  const baseline = baselineFor(row, window, refFriday);
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
  refFriday: string | null = null,
  /** Current Beatport chart rank for a row (null = not charted); needed for the "beatport" key. */
  rankOf: (row: UploadTrackRow) => number | null = () => null,
): UploadTrackRow[] {
  const mult = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let c = 0;
    if (key === "track") c = mult * a.name.localeCompare(b.name);
    else if (key === "streams") c = compareNullable(a.latestPlaycount, b.latestPlaycount, dir);
    else if (key === "beatport") c = compareNullable(rankOf(a), rankOf(b), dir);
    else if (key === "growth") {
      const get = (r: UploadTrackRow) =>
        metric === "pct" ? growthPercentFor(r, window, refFriday) : growthFor(r, window, refFriday);
      c = compareNullable(get(a), get(b), dir);
      // In % mode, rows without a % (zero baseline) rank by absolute growth, after rows with a %.
      if (c === 0 && metric === "pct") c = compareNullable(growthFor(a, window, refFriday), growthFor(b, window, refFriday), "desc");
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

export function summarize(current: UploadTrackRow[], window: GrowthWindow, refFriday: string | null = null): UploadSummary {
  let totalStreams = 0;
  let windowGrowth: number | null = null;
  let topGainer: UploadSummary["topGainer"] = null;
  for (const row of current) {
    totalStreams += row.latestPlaycount ?? 0;
    const g = growthFor(row, window, refFriday);
    if (g === null) continue;
    windowGrowth = (windowGrowth ?? 0) + g;
    if (g > 0 && (topGainer === null || g > topGainer.growth)) topGainer = { row, growth: g };
  }
  return { trackCount: current.length, totalStreams, windowGrowth, topGainer };
}

export function parseWindow(value: string | null | undefined): GrowthWindow {
  return value === "1d" || value === "28d" || value === "added" || value === "7d" || value === "fri" ? value : "fri";
}

export function parseMetric(value: string | null | undefined): GrowthMetric {
  return value === "pct" ? "pct" : "abs";
}
