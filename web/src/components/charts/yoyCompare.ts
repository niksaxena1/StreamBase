// Pure helpers behind the "Compare: Previous year" overlay on the shared daily charts.
// No React, no Recharts: unit tested in yoyCompare.test.ts.
//
// The overlay shows the same calendar window shifted back one year at the same granularity. Each plotted row gets
// `_prevValue` (the previous-year value for that row), `_prevDate`, `_prevLabel` and `_yoyPct` so the Recharts tooltip
// can read everything from the hovered row's payload.

import {
  dayNumber,
  formatAdaptiveTooltipDate,
  isIsoDate,
  isoFromDayNumber,
  type ChartGranularity,
  type ViewWindow,
} from "./aggregateSeries";

export type YoYMeta = {
  /** Previous-year value for this row (average per day for weekly/monthly averages, last value for cumulative). */
  _prevValue: number | null;
  /** First day of the shifted bucket. */
  _prevDate: string;
  /** Tooltip label for the shifted bucket, e.g. "Fri 15 Sep 2023". */
  _prevLabel: string;
  /** Percent change versus the previous year; null when either side is missing or the previous value is 0. */
  _yoyPct: number | null;
};

export const YOY_SERIES_KEY = "_prevValue";

/** Same calendar day one year earlier. 29 Feb maps to 28 Feb. */
export function shiftIsoYears(iso: string, years: number): string {
  const year = Number(iso.slice(0, 4)) + years;
  const month = iso.slice(5, 7);
  let day = Number(iso.slice(8, 10));
  if (month === "02" && day === 29) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!leap) day = 28;
  }
  return `${String(year).padStart(4, "0")}-${month}-${String(day).padStart(2, "0")}`;
}

export function shiftWindowBackOneYear(window: ViewWindow): ViewWindow {
  return { start: shiftIsoYears(window.start, -1), end: shiftIsoYears(window.end, -1) };
}

function finite(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Day -> value for every row with a finite value (rows may arrive in any order). */
export function dailyValueMap(rows: ReadonlyArray<{ date: string }>, valueKey: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (!isIsoDate(row.date)) continue;
    const n = finite((row as Record<string, unknown>)[valueKey]);
    if (n !== null) map.set(row.date, n);
  }
  return map;
}

/**
 * Whether the shifted window has any data. The toggle is only offered when it does, so it never draws an empty line.
 */
export function previousYearAvailable(
  rows: ReadonlyArray<{ date: string }>,
  valueKey: string,
  window: ViewWindow | null,
): boolean {
  if (!window) return false;
  const prev = shiftWindowBackOneYear(window);
  for (const row of rows) {
    if (!isIsoDate(row.date) || row.date < prev.start || row.date > prev.end) continue;
    if (finite((row as Record<string, unknown>)[valueKey]) !== null) return true;
  }
  return false;
}

/** Average of the days with data ("average") or the latest day with data ("last") over an inclusive date range. */
export function valueOverRange(
  byDay: ReadonlyMap<string, number>,
  start: string,
  end: string,
  kind: "average" | "last",
): number | null {
  const first = dayNumber(start);
  const last = dayNumber(end);
  let count = 0;
  let total = 0;
  let latest: number | null = null;
  for (let day = first; day <= last; day++) {
    const value = byDay.get(isoFromDayNumber(day));
    if (value === undefined) continue;
    count++;
    total += value;
    latest = value;
  }
  if (count === 0) return null;
  return kind === "last" ? latest : total / count;
}

/** Percent change of `current` versus `previous`; null when it is undefined (missing side or previous = 0). */
export function yoyPercent(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** "+17.5%", "-3.2%", "0.0%". */
export function formatYoyPercent(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  const text = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${text}%`;
  if (rounded < 0) return `-${text}%`;
  return `${text}%`;
}

type DisplayRow = { date: string; _bucketKind?: ChartGranularity; _bucketEnd?: string };

/**
 * Attach the previous-year overlay to the rows the chart draws (daily rows, or weekly/monthly bucket rows).
 * `allRows` is every loaded daily row (not just the visible window), so a zoomed view can still reach back a year.
 */
export function withPreviousYear<R extends DisplayRow>(args: {
  displayRows: ReadonlyArray<R>;
  allRows: ReadonlyArray<{ date: string }>;
  valueKey: string;
  isCumulative: boolean;
  granularity: ChartGranularity;
}): Array<R & YoYMeta> {
  const { displayRows, allRows, valueKey, isCumulative, granularity } = args;
  const byDay = dailyValueMap(allRows, valueKey);
  const kind = isCumulative ? "last" : "average";
  return displayRows.map((row) => {
    const bucketEnd = granularity === "daily" ? row.date : (row._bucketEnd ?? row.date);
    const prevStart = shiftIsoYears(row.date, -1);
    const prevEnd = shiftIsoYears(bucketEnd, -1);
    const prevValue =
      granularity === "daily"
        ? (byDay.get(prevStart) ?? null)
        : valueOverRange(byDay, prevStart, prevEnd < prevStart ? prevStart : prevEnd, kind);
    const current = finite((row as Record<string, unknown>)[valueKey]);
    return {
      ...row,
      _prevValue: prevValue,
      _prevDate: prevStart,
      _prevLabel: formatAdaptiveTooltipDate(prevStart, granularity),
      _yoyPct: yoyPercent(current, prevValue),
    };
  });
}
