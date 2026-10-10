import { DAY_MS, dateKey, utcDate } from "../../lib/format";
export type TimePoint = {
  date: string;
  [key: string]:
    string | number | null | undefined | Record<string, string | number | null>;
};
export type Series = {
  key: string;
  label: string;
  type?: "line" | "area" | "bar";
  color?: string;
  movingAverage?: boolean;
  /** Known days (of the trailing 7 consecutive UTC dates) a moving-average point needs. Default 7. */
  movingAverageMinKnown?: number;
  /** Draw the line dashed (7-day average lines). */
  dashed?: boolean;
};
export type Gap = { from: string; to: string; label?: string };
export type PreparedPoint = TimePoint & { date: string; timestamp: number };
export type GapBand = Gap & { x1: number; x2: number };
/** Inserts explicit null observations at missing intervals. No interpolation or zero fill. */
export function prepareTimeSeries(
  input: TimePoint[],
  series: Series[],
  explicitGaps: Gap[] = [],
  stepDays = 1,
): { points: PreparedPoint[]; gaps: GapBand[] } {
  if (!Number.isFinite(stepDays) || stepDays < 1)
    throw new RangeError("stepDays must be at least 1");
  const byDate = new Map<string, PreparedPoint>(
    input.map((point) => {
      const date = dateKey(point.date);
      return [date, { ...point, date, timestamp: utcDate(date).getTime() }];
    }),
  );
  const sorted = [...byDate.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (!sorted.length) return { points: [], gaps: [] };
  const points: PreparedPoint[] = [];
  const gapRanges = explicitGaps.map((gap) => ({
    ...gap,
    from: dateKey(gap.from),
    to: dateKey(gap.to),
  }));
  for (let index = 0; index < sorted.length; index++) {
    const current = sorted[index],
      previous = sorted[index - 1];
    if (previous) {
      for (
        let stamp = previous.timestamp + stepDays * DAY_MS;
        stamp < current.timestamp;
        stamp += stepDays * DAY_MS
      ) {
        points.push({
          date: dateKey(new Date(stamp).toISOString()),
          timestamp: stamp,
          ...Object.fromEntries(series.map((item) => [item.key, null])),
        });
      }
    }
    const inGap = gapRanges.some(
      (gap) => current.date >= gap.from && current.date <= gap.to,
    );
    const point: PreparedPoint = { ...current };
    series.forEach((item) => {
      const value = current[item.key];
      point[item.key] =
        !inGap && typeof value === "number" && Number.isFinite(value)
          ? value
          : null;
    });
    points.push(point);
  }
  const gaps: GapBand[] = [];
  let run: PreparedPoint[] = [];
  function flush() {
    if (!run.length) return;
    const from = run[0].date,
      to = run[run.length - 1].date;
    gaps.push({
      from,
      to,
      label:
        gapRanges.find((gap) => from >= gap.from && from <= gap.to)?.label ??
        "Missing observations",
      x1: run[0].timestamp - (stepDays * DAY_MS) / 2,
      x2: run[run.length - 1].timestamp + (stepDays * DAY_MS) / 2,
    });
    run = [];
  }
  for (const point of points) {
    if (series.length && series.every((item) => point[item.key] === null))
      run.push(point);
    else flush();
  }
  flush();
  // A partial-series explicit gap is already null for all supplied series above.
  series
    .filter((item) => item.movingAverage)
    .forEach((item) =>
      points.forEach((point, index) => {
        const window = points.slice(Math.max(0, index - 6), index + 1);
        const minKnown = Math.min(7, Math.max(1, item.movingAverageMinKnown ?? 7));
        const known = window.filter((row) => typeof row[item.key] === "number");
        const valid =
          window.length === 7 &&
          known.length >= minKnown &&
          window.every(
            (row, i) =>
              i === 0 || row.timestamp - window[i - 1].timestamp === DAY_MS,
          );
        point[`${item.key}__ma7`] = valid
          ? known.reduce((sum, row) => sum + (row[item.key] as number), 0) /
            known.length
          : null;
      }),
    );
  return { points, gaps };
}
export function histogramBins(
  values: number[],
  count = 10,
): { name: string; value: number; from: number; to: number }[] {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return [];
  const min = Math.min(...clean),
    max = Math.max(...clean);
  const bins = Math.max(1, Math.min(100, Math.floor(count) || 1)),
    width = max === min ? 1 : (max - min) / bins;
  const result = Array.from({ length: max === min ? 1 : bins }, (_, i) => ({
    name: `${Number((min + i * width).toFixed(2))}–${Number((min + (i + 1) * width).toFixed(2))}`,
    value: 0,
    from: min + i * width,
    to: min + (i + 1) * width,
  }));
  clean.forEach(
    (value) =>
      result[Math.min(result.length - 1, Math.floor((value - min) / width))]
        .value++,
  );
  return result;
}

export type WeekendBand = { from: string; to: string; x1: number; x2: number };
/**
 * Saturday/Sunday bands for a daily chart (UTC days), merged when adjacent. Each band spans
 * half a day either side of its first/last day so it frames the bars. Weekly and monthly
 * grains (stepDays > 1) have no weekend concept and return nothing.
 */
export function weekendBands(
  points: { date: string; timestamp: number }[],
  stepDays = 1,
): WeekendBand[] {
  if (stepDays !== 1) return [];
  const bands: WeekendBand[] = [];
  for (const point of points) {
    const weekday = new Date(point.timestamp).getUTCDay();
    if (weekday !== 0 && weekday !== 6) continue;
    const last = bands[bands.length - 1];
    if (last && point.timestamp - DAY_MS / 2 <= last.x2) {
      last.to = point.date;
      last.x2 = point.timestamp + DAY_MS / 2;
    } else
      bands.push({
        from: point.date,
        to: point.date,
        x1: point.timestamp - DAY_MS / 2,
        x2: point.timestamp + DAY_MS / 2,
      });
  }
  return bands;
}
/** Weekend bands are only readable when a day is a few pixels wide. */
export const MAX_WEEKEND_POINTS = 450;

export type ZoomMode = "all" | "1y" | "90d" | "30d" | "selection";
export const ZOOM_DAYS: Record<"1y" | "90d" | "30d", number> = {
  "1y": 365,
  "90d": 90,
  "30d": 30,
};
/**
 * Visible window for a zoom mode: the trailing N days of the data, or the selected dates.
 * Null means "show everything". Zoom only focuses the view; it never changes data or the
 * lookup calculator.
 */
export function zoomWindow(
  points: { timestamp: number }[],
  mode: ZoomMode,
  selection?: { from: string; to: string },
): { from: number; to: number } | null {
  if (!points.length || mode === "all") return null;
  const first = points[0].timestamp,
    last = points[points.length - 1].timestamp;
  if (mode === "selection") {
    if (!selection) return null;
    const from = Date.parse(`${selection.from}T00:00:00Z`),
      to = Date.parse(`${selection.to}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    // A single day (or a very short selection) still needs some context to read.
    const pad = Math.max(0, (7 * DAY_MS - (to - from)) / 2) + (to - from) * 0.03;
    let lo = Math.max(first, from - pad),
      hi = Math.min(last, to + pad);
    // Clamping at an edge of the data must not leave a sliver: keep at least a week in view.
    if (hi - lo < 7 * DAY_MS) {
      hi = Math.min(last, lo + 7 * DAY_MS);
      lo = Math.max(first, hi - 7 * DAY_MS);
    }
    return { from: lo, to: hi };
  }
  const from = Math.max(first, last - (ZOOM_DAYS[mode] - 1) * DAY_MS);
  return from <= first ? null : { from, to: last };
}
/** A labelled flag at a date on a time-series chart (e.g. a streaming milestone). */
export type ChartMarker = {
  date: string;
  /** Short flag text, e.g. "1M" or "250K +2". */
  label: string;
  /** Tooltip lines. */
  text: string[];
  /** Curve value the flag points at; null/absent = no dot. */
  value?: number | null;
};
/** Daily-change bars use one colour everywhere (negative days switch to the error colour). */
export const DAILY_BAR_COLOR = "var(--sb-accent-stroke)";
/** The API's 7-day average (MA7) line, drawn like the lookup's computed one. */
export const MA_LABEL = "7-day avg";
