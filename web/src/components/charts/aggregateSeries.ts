// Pure helpers behind the adaptive (zoom / granularity / archived-boundary) daily charts.
// No React, no Recharts: everything here is unit tested in aggregateSeries.test.ts.
//
// Conventions
// - Dates are ISO `YYYY-MM-DD` strings (the chart "data date"); all maths is UTC so DST never shifts a day.
// - Rows arrive newest-first (like every shared daily chart) and leave newest-first.
// - A null value is "no data" and never counts as 0 (gaps stay gaps).

/**
 * First day covered by live StreamBase snapshots. Earlier days are archived (recovered Grafana) history.
 * This is the DB run date; charts show data dates (run date minus the SOT lag), see FIRST_LIVE_DATA_DATE_ISO.
 */
export const FIRST_LIVE_RUN_DATE_ISO = "2026-01-24";
/** Same boundary in the chart's data-date basis. Fallback when the server provides no provenance. */
export const FIRST_LIVE_SNAPSHOT_DATE_ISO = dataDateFromRunDate(FIRST_LIVE_RUN_DATE_ISO);
/** Earliest day any stream history exists. */
export const EARLIEST_HISTORY_DATE_ISO = "2023-07-08";

/** Up to this many visible days Auto stays daily (about six months). */
export const DAILY_MAX_SPAN_DAYS = 400; // keeps existing 30/90/365-day views daily (owner preference)
/** Up to this many visible days Auto uses weekly buckets (two years); beyond it, monthly. */
export const WEEKLY_MAX_SPAN_DAYS = 730;
/** Axis labels carry the year once the span exceeds about ten months. */
export const AXIS_YEAR_SPAN_DAYS = 304;
/** "Go to date" shows this many days either side of the chosen date. */
export const GO_TO_DATE_RADIUS_DAYS = 30;

export type ChartGranularity = "daily" | "weekly" | "monthly";
export type GranularityMode = "auto" | ChartGranularity;
export type ViewWindow = { start: string; end: string };

import { dataDateFromRunDate } from "@/lib/sotDates";

const MS_PER_DAY = 86_400_000;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/** Days since 1970-01-01 (UTC) for an ISO date. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function isoFromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  return isoFromDayNumber(dayNumber(iso) + days);
}

/** Inclusive number of calendar days between two ISO dates. */
export function spanDays(startIso: string, endIso: string): number {
  return Math.max(0, dayNumber(endIso) - dayNumber(startIso) + 1);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return new Date(dayNumber(iso) * MS_PER_DAY).getUTCDay();
}

export function selectGranularity(span: number, mode: GranularityMode = "auto"): ChartGranularity {
  if (mode !== "auto") return mode;
  if (span <= DAILY_MAX_SPAN_DAYS) return "daily";
  if (span <= WEEKLY_MAX_SPAN_DAYS) return "weekly";
  return "monthly";
}

/** First day of the bucket containing `iso`: the day itself, its ISO-week Monday, or the 1st of its month. */
export function bucketStartIso(iso: string, granularity: ChartGranularity): string {
  if (granularity === "daily") return iso;
  if (granularity === "monthly") return `${iso.slice(0, 7)}-01`;
  const sinceMonday = (weekdayOf(iso) + 6) % 7;
  return addDaysIso(iso, -sinceMonday);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Last day of the bucket that starts at `startIso`. */
export function bucketEndIso(startIso: string, granularity: ChartGranularity): string {
  if (granularity === "daily") return startIso;
  if (granularity === "weekly") return addDaysIso(startIso, 6);
  const [y, m] = startIso.split("-").map(Number);
  return `${startIso.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function bucketCalendarDays(startIso: string, granularity: ChartGranularity): number {
  return spanDays(startIso, bucketEndIso(startIso, granularity));
}

function nextBucketStart(startIso: string, granularity: ChartGranularity): string {
  return addDaysIso(bucketEndIso(startIso, granularity), 1);
}

// ---------------------------------------------------------------------------
// Archived boundary
// ---------------------------------------------------------------------------

/** True for days before the first live snapshot (served from archived history). */
export function isArchivedDate(dateIso: string, firstLiveIso: string = FIRST_LIVE_SNAPSHOT_DATE_ISO): boolean {
  return dateIso < firstLiveIso;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type SeriesBucket = {
  /** Bucket start (the x-axis key). For daily buckets this is the day itself. */
  date: string;
  endDate: string;
  /** Average per covered day (daily-total series) or the last value (cumulative series); null without data. */
  value: number | null;
  /** Sum of covered days (daily-total series); null for cumulative series or without data. */
  total: number | null;
  coverageDays: number;
  calendarDays: number;
  /** Fewer covered days than calendar days: gaps, an unfinished week/month, or a bucket cut off by the loaded range. */
  partial: boolean;
};

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Bucket an ascending-or-unordered list of daily points. Every calendar bucket between the first and last point (or
 * between `range`, when given) is emitted, so gaps appear as null buckets and the x spacing stays uniform.
 *
 * `kind: "average"` (daily totals): value = mean of days that have data, total = their sum.
 * `kind: "last"` (cumulative totals): value = latest covered day in the bucket.
 */
export function aggregateSeries(
  points: ReadonlyArray<{ date: string; value: unknown }>,
  granularity: ChartGranularity,
  kind: "average" | "last",
  range?: ViewWindow,
): SeriesBucket[] {
  const byDay = new Map<string, number | null>();
  let min: string | null = null;
  let max: string | null = null;
  for (const point of points) {
    if (!isIsoDate(point.date)) continue;
    byDay.set(point.date, finiteOrNull(point.value));
    if (min === null || point.date < min) min = point.date;
    if (max === null || point.date > max) max = point.date;
  }
  const from = range?.start ?? min;
  const to = range?.end ?? max;
  if (!from || !to || from > to) return [];

  const out: SeriesBucket[] = [];
  for (let start = bucketStartIso(from, granularity); start <= to; start = nextBucketStart(start, granularity)) {
    const endDate = bucketEndIso(start, granularity);
    const calendarDays = spanDays(start, endDate);
    let coverageDays = 0;
    let total = 0;
    let last: number | null = null;
    const first = dayNumber(start);
    for (let offset = 0; offset < calendarDays; offset++) {
      const value = byDay.get(isoFromDayNumber(first + offset));
      if (value == null) continue;
      coverageDays++;
      total += value;
      last = value;
    }
    out.push({
      date: start,
      endDate,
      value: coverageDays === 0 ? null : kind === "last" ? last : total / coverageDays,
      total: coverageDays === 0 || kind === "last" ? null : total,
      coverageDays,
      calendarDays,
      partial: coverageDays < calendarDays,
    });
  }
  return out;
}

export type AdaptiveMeta = {
  _bucketKind: ChartGranularity;
  _bucketEnd: string;
  /** Sum of the covered days when the plotted value is a per-day average. */
  _bucketTotal: number | null;
  _coverageDays: number;
  _calendarDays: number;
  /** Hollow point: fewer covered days than the bucket spans. Never set for daily rows. */
  _partialBucket: boolean;
  /** Whole bucket lies before the first live snapshot. */
  _archived: boolean;
  /** Bucket mixes archived and live days. */
  _straddlesArchive: boolean;
  /** True when the plotted value is an average per day over the covered days. */
  _isAverage: boolean;
};

export type AdaptiveSeries<R extends { date: string }> = {
  /** Newest first, ready to hand to the daily charts. */
  rowsDesc: Array<R & Partial<AdaptiveMeta>>;
  granularity: ChartGranularity;
  /** Daily was chosen explicitly although the span is longer than the daily limit. */
  forcedDaily: boolean;
  spanDays: number;
  /** Effective visible window, clamped to the loaded data. Null when there is no data. */
  window: ViewWindow | null;
  /** Loaded data extent. */
  bounds: ViewWindow | null;
  /** Input dates are not plain days (page-level weekly/monthly sums); the adaptive layer is bypassed. */
  preBucketed: boolean;
};

export function clampWindow(window: ViewWindow, bounds: ViewWindow): ViewWindow {
  const start = window.start < bounds.start ? bounds.start : window.start > bounds.end ? bounds.end : window.start;
  const end = window.end > bounds.end ? bounds.end : window.end < bounds.start ? bounds.start : window.end;
  return start <= end ? { start, end } : { start: end, end: start };
}

export function dataBounds(rows: ReadonlyArray<{ date: string }>): ViewWindow | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const row of rows) {
    if (!isIsoDate(row.date)) continue;
    if (min === null || row.date < min) min = row.date;
    if (max === null || row.date > max) max = row.date;
  }
  return min && max ? { start: min, end: max } : null;
}

/**
 * Turn the loaded daily rows into what the chart should draw for the current zoom window and granularity mode.
 * Daily output keeps the original rows (MA7 etc. intact); weekly/monthly output is one synthetic row per bucket.
 */
export function buildAdaptiveSeries<R extends { date: string }>(args: {
  rowsDesc: R[];
  valueKey: string;
  isCumulative: boolean;
  window: ViewWindow | null;
  mode: GranularityMode;
  firstLiveIso?: string;
}): AdaptiveSeries<R> {
  const { rowsDesc, valueKey, isCumulative, mode } = args;
  const firstLive = args.firstLiveIso ?? FIRST_LIVE_SNAPSHOT_DATE_ISO;
  const bounds = dataBounds(rowsDesc);
  const preBucketed = rowsDesc.some((row) => !isIsoDate(row.date));
  if (!bounds || preBucketed) {
    return { rowsDesc, granularity: "daily", forcedDaily: false, spanDays: rowsDesc.length, window: bounds, bounds, preBucketed };
  }

  const window = args.window ? clampWindow(args.window, bounds) : bounds;
  const span = spanDays(window.start, window.end);
  const granularity = selectGranularity(span, mode);
  const forcedDaily = mode === "daily" && span > DAILY_MAX_SPAN_DAYS;

  if (granularity === "daily") {
    const inWindow = rowsDesc.filter((row) => row.date >= window.start && row.date <= window.end);
    const dailyMeta = (date: string) => ({
      _bucketKind: "daily" as const,
      _partialBucket: false,
      _archived: isArchivedDate(date, firstLive),
    });
    let rows: Array<R & Partial<AdaptiveMeta>>;
    if (inWindow.length < span) {
      // Missing calendar days become explicit null rows so the line (and the cumulative line) breaks at a gap.
      const present = new Map(inWindow.map((row) => [row.date, row]));
      rows = [];
      for (let day = dayNumber(window.end); day >= dayNumber(window.start); day--) {
        const date = isoFromDayNumber(day);
        const row = present.get(date);
        rows.push(
          row
            ? { ...row, ...dailyMeta(date) }
            : ({ date, [valueKey]: null, ma7: null, ...dailyMeta(date) } as unknown as R & Partial<AdaptiveMeta>),
        );
      }
    } else {
      rows = inWindow.map((row) => ({ ...row, ...dailyMeta(row.date) }));
    }
    return { rowsDesc: rows, granularity, forcedDaily, spanDays: span, window, bounds, preBucketed };
  }

  const buckets = aggregateSeries(
    rowsDesc.map((row) => ({ date: row.date, value: (row as Record<string, unknown>)[valueKey] })),
    granularity,
    isCumulative ? "last" : "average",
    window,
  );
  const rows = buckets.map((bucket) => ({
    date: bucket.date,
    [valueKey]: bucket.value,
    _bucketKind: granularity,
    _bucketEnd: bucket.endDate,
    _bucketTotal: bucket.total,
    _coverageDays: bucket.coverageDays,
    _calendarDays: bucket.calendarDays,
    _partialBucket: bucket.partial,
    _archived: bucket.endDate < firstLive,
    _straddlesArchive: bucket.date < firstLive && bucket.endDate >= firstLive,
    _isAverage: !isCumulative,
  })) as unknown as Array<R & Partial<AdaptiveMeta>>;
  rows.reverse();
  return { rowsDesc: rows, granularity, forcedDaily, spanDays: span, window, bounds, preBucketed };
}

// ---------------------------------------------------------------------------
// Zoom / drill helpers
// ---------------------------------------------------------------------------

/** Window covered by the buckets a drag selection spans (keys may arrive in either order). */
export function windowForBucketKeys(
  a: string,
  b: string,
  granularity: ChartGranularity,
  bounds: ViewWindow | null,
): ViewWindow {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const window = { start: lo, end: bucketEndIso(hi, granularity) };
  return bounds ? clampWindow(window, bounds) : window;
}

export function windowForBucket(key: string, granularity: ChartGranularity, bounds: ViewWindow | null): ViewWindow {
  return windowForBucketKeys(key, key, granularity, bounds);
}

/** "Go to date": the chosen day +/- 30 days, clamped to what is loaded. */
export function goToDateWindow(dateIso: string, bounds: ViewWindow | null): ViewWindow {
  const window = { start: addDaysIso(dateIso, -GO_TO_DATE_RADIUS_DAYS), end: addDaysIso(dateIso, GO_TO_DATE_RADIUS_DAYS) };
  return bounds ? clampWindow(window, bounds) : window;
}

/** Smallest range (in days back from `latestIso`) that includes `targetIso` minus the go-to radius, capped at maxDays. */
export function rangeDaysNeededFor(latestIso: string, targetIso: string, maxDays: number): number {
  const needed = dayNumber(latestIso) - dayNumber(addDaysIso(targetIso, -GO_TO_DATE_RADIUS_DAYS));
  return Math.max(1, Math.min(maxDays, needed));
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

/** The year is shown when the visible span crosses a year boundary or exceeds about ten months. */
export function axisShowsYear(window: ViewWindow | null): boolean {
  if (!window) return false;
  return window.start.slice(0, 4) !== window.end.slice(0, 4) || spanDays(window.start, window.end) > AXIS_YEAR_SPAN_DAYS;
}

function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

function monthIndex(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** X-axis tick label: daily "12 Feb" (+ " '24" with the year), multi-year "Feb '24", monthly "Mar 2024". */
export function formatAdaptiveTick(
  key: string,
  granularity: ChartGranularity,
  window: ViewWindow | null,
): string {
  if (!isIsoDate(key)) return key;
  const year = key.slice(0, 4);
  if (granularity === "monthly") return `${MONTHS_SHORT[monthIndex(key)]} ${year}`;
  const showYear = axisShowsYear(window);
  if (!showYear) return `${dayOfMonth(key)} ${MONTHS_SHORT[monthIndex(key)]}`;
  const multiYear = window ? spanDays(window.start, window.end) > WEEKLY_MAX_SPAN_DAYS : false;
  if (multiYear) return `${MONTHS_SHORT[monthIndex(key)]} '${year.slice(2)}`;
  return `${dayOfMonth(key)} ${MONTHS_SHORT[monthIndex(key)]} '${year.slice(2)}`;
}

/** Tooltip heading: "Thu 14 Mar 2024", "Week of 4 Mar 2024", "March 2024". */
export function formatAdaptiveTooltipDate(key: string, granularity: ChartGranularity = "daily"): string {
  if (!isIsoDate(key)) return key;
  const year = key.slice(0, 4);
  const month = monthIndex(key);
  if (granularity === "monthly") return `${MONTHS_LONG[month]} ${year}`;
  const base = `${dayOfMonth(key)} ${MONTHS_SHORT[month]} ${year}`;
  if (granularity === "weekly") return `Week of ${base}`;
  return `${WEEKDAYS_SHORT[weekdayOf(key)]} ${base}`;
}

/** Breadcrumb label for a drilled-into bucket: "Mar 2024", "Week of 4 Mar 2024" or a custom range. */
export function formatWindowLabel(window: ViewWindow, granularity?: ChartGranularity): string {
  const startYear = window.start.slice(0, 4);
  if (granularity === "monthly") return `${MONTHS_SHORT[monthIndex(window.start)]} ${startYear}`;
  if (granularity === "weekly") return `Week of ${dayOfMonth(window.start)} ${MONTHS_SHORT[monthIndex(window.start)]} ${startYear}`;
  const from = `${dayOfMonth(window.start)} ${MONTHS_SHORT[monthIndex(window.start)]}${startYear === window.end.slice(0, 4) ? "" : ` ${startYear}`}`;
  const to = `${dayOfMonth(window.end)} ${MONTHS_SHORT[monthIndex(window.end)]} ${window.end.slice(0, 4)}`;
  return window.start === window.end ? to : `${from} – ${to}`;
}

// ---------------------------------------------------------------------------
// Archived boundary for ReferenceArea (categorical x keys)
// ---------------------------------------------------------------------------

/**
 * Keys bounding the archived shading among the visible x keys (ascending). Null when no visible bucket is archived.
 * A bucket that straddles the boundary is included so the shading reaches the first live day.
 */
export function archivedShadeKeys(keysAsc: readonly string[], firstLiveIso: string): { x1: string; x2: string } | null {
  if (keysAsc.length === 0 || keysAsc[0] >= firstLiveIso) return null;
  let last = keysAsc[0];
  for (const key of keysAsc) {
    if (key >= firstLiveIso) break;
    last = key;
  }
  return { x1: keysAsc[0], x2: last };
}

// ---------------------------------------------------------------------------
// CSV export: visible range as DAILY rows, regardless of granularity
// ---------------------------------------------------------------------------

export type DailyExportRow = { date: string; total: number | null; daily: number | null; archived: boolean };

/**
 * Join the daily and cumulative series by date and keep only the visible window. Always daily resolution; MA7 and
 * bucket columns are intentionally left out.
 */
export function buildDailyExportRows(args: {
  dailyRows: ReadonlyArray<{ date: string } & Record<string, unknown>>;
  dailyKey: string;
  totalRows: ReadonlyArray<{ date: string } & Record<string, unknown>>;
  totalKey: string;
  window: ViewWindow | null;
  firstLiveIso?: string;
}): DailyExportRow[] {
  const firstLive = args.firstLiveIso ?? FIRST_LIVE_SNAPSHOT_DATE_ISO;
  const byDate = new Map<string, DailyExportRow>();
  const inWindow = (date: string) => !args.window || (date >= args.window.start && date <= args.window.end);
  const row = (date: string) => {
    let existing = byDate.get(date);
    if (!existing) {
      existing = { date, total: null, daily: null, archived: isArchivedDate(date, firstLive) };
      byDate.set(date, existing);
    }
    return existing;
  };
  for (const r of args.dailyRows) if (isIsoDate(r.date) && inWindow(r.date)) row(r.date).daily = finiteOrNull(r[args.dailyKey]);
  for (const r of args.totalRows) if (isIsoDate(r.date) && inWindow(r.date)) row(r.date).total = finiteOrNull(r[args.totalKey]);
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
