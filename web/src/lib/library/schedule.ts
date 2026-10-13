import { formatReleaseDate, isValidIsoDate } from "./format";
import type { LibraryRow } from "./types";

/** A week with more releases than this is flagged "Busy". */
export const BUSY_WEEK_THRESHOLD = 14;

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Safety stop for the gap filler (about 77 years of weeks). */
const MAX_WEEKS = 4000;

export type ScheduleWeek = {
  /** The week's Monday (YYYY-MM-DD); unique and sortable. */
  key: string;
  /** The week's Friday, the day the week is named after. */
  friday: string;
  /** "Fri 23 Oct 2026" */
  label: string;
  rows: LibraryRow[];
  count: number;
  /** Releases per entity code, biggest first. Rows with no entity count as "unassigned". */
  entities: Array<{ code: string; count: number }>;
  empty: boolean;
  busy: boolean;
  /** True for the week that contains `today`. */
  current: boolean;
};

export type Schedule = {
  weeks: ScheduleWeek[];
  /** Rows with no (valid) release date. */
  noDate: LibraryRow[];
  /** Releases in weeks before the current one, left out because past weeks are hidden. */
  hiddenPast: number;
  /** Biggest release count among the weeks shown (the load bar scale). */
  maxCount: number;
};

const toMs = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday of the week containing `iso` (weeks run Monday to Sunday). */
export function weekStart(iso: string): string {
  const ms = toMs(iso);
  const dow = new Date(ms).getUTCDay(); // 0 = Sunday
  return fromMs(ms - ((dow + 6) % 7) * DAY_MS);
}

/** The Friday of the week containing `iso`. */
export function weekFriday(iso: string): string {
  return fromMs(toMs(weekStart(iso)) + 4 * DAY_MS);
}

/** "Fri 23 Oct 2026" for the week containing `iso`. */
export function weekLabel(iso: string): string {
  const friday = weekFriday(iso);
  return `${WEEKDAYS[new Date(toMs(friday)).getUTCDay()]} ${formatReleaseDate(friday)}`;
}

const hasDate = (row: LibraryRow): row is LibraryRow & { release_date: string } =>
  row.release_date !== null && isValidIsoDate(row.release_date);

function byArtist(a: LibraryRow, b: LibraryRow): number {
  const c = (a.sheet_artist ?? "").localeCompare(b.sheet_artist ?? "", "en", { sensitivity: "base" });
  return c !== 0 ? c : a.catalog_id.localeCompare(b.catalog_id);
}

function byDateThenArtist(a: LibraryRow, b: LibraryRow): number {
  const da = a.release_date ?? "";
  const db = b.release_date ?? "";
  if (da !== db) return da < db ? -1 : 1;
  return byArtist(a, b);
}

function buildWeek(key: string, rows: LibraryRow[], currentKey: string): ScheduleWeek {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const code = row.entity || "unassigned";
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const friday = fromMs(toMs(key) + 4 * DAY_MS);
  return {
    key,
    friday,
    label: weekLabel(key),
    rows,
    count: rows.length,
    entities: [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    empty: rows.length === 0,
    busy: rows.length > BUSY_WEEK_THRESHOLD,
    current: key === currentKey,
  };
}

/**
 * Groups releases by release week, oldest first. Without `showPast`, weeks before the one that holds
 * `today` are left out. Weeks with no releases between the first and last shown week are included
 * (flagged `empty`) so gaps are visible. Undated releases are returned separately.
 */
export function groupByWeek(rows: LibraryRow[], today: string, opts: { showPast?: boolean } = {}): Schedule {
  const currentKey = weekStart(today);
  const buckets = new Map<string, LibraryRow[]>();
  const noDate: LibraryRow[] = [];
  let hiddenPast = 0;

  for (const row of rows) {
    if (!hasDate(row)) {
      noDate.push(row);
      continue;
    }
    const key = weekStart(row.release_date);
    if (!opts.showPast && key < currentKey) {
      hiddenPast++;
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const weeks: ScheduleWeek[] = [];
  const keys = [...buckets.keys()].sort();
  if (keys.length > 0) {
    const first = toMs(keys[0]);
    const last = toMs(keys[keys.length - 1]);
    for (let ms = first, n = 0; ms <= last && n < MAX_WEEKS; ms += 7 * DAY_MS, n++) {
      const key = fromMs(ms);
      weeks.push(buildWeek(key, (buckets.get(key) ?? []).sort(byDateThenArtist), currentKey));
    }
  }

  return {
    weeks,
    noDate: noDate.sort(byArtist),
    hiddenPast,
    maxCount: weeks.reduce((max, w) => Math.max(max, w.count), 0),
  };
}
