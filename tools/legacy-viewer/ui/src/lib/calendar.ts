import { DAY_MS, utcDate } from "./format";

type Range = { from: string; to: string };

/** All calendar logic is UTC and string based (YYYY-MM-DD); pure and unit-tested. */
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (day: string, delta: number): string =>
  isoDay(new Date(utcDate(day).getTime() + delta * DAY_MS));
/** Add whole months; the day of month is clamped (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, delta: number): string {
  const date = utcDate(day);
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1),
  );
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return isoDay(target);
}
export const clampDay = (day: string, bounds: Range): string =>
  day < bounds.from ? bounds.from : day > bounds.to ? bounds.to : day;
/** Strict YYYY-MM-DD → the same string for a real calendar day, otherwise null. */
export function parseTypedDate(text: string): string | null {
  const value = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDay(date) === value
    ? value
    : null;
}
/** Weeks (Monday first) covering a month: 7 ISO days each, padded with neighbouring months. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((lead + last) / 7);
  const start = first.getTime() - lead * DAY_MS;
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) =>
      isoDay(new Date(start + (w * 7 + d) * DAY_MS)),
    ),
  );
}
export type DayRanges = readonly (readonly [string, string])[];
export type DayStatus = "reading" | "gap" | "outside";
/** Is the day inside one of the sorted inclusive [first, last] runs? */
export function inRanges(day: string, ranges: DayRanges): boolean {
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (day < ranges[mid][0]) high = mid - 1;
    else if (day > ranges[mid][1]) low = mid + 1;
    else return true;
  }
  return false;
}
/**
 * reading = the track has a counter reading that day; gap = inside its tracking span but no reading;
 * outside = before the first or after the last reading. Without `ranges` every day in bounds is a reading.
 */
export function dayStatus(
  day: string,
  bounds: Range,
  ranges?: DayRanges,
): DayStatus {
  if (day < bounds.from || day > bounds.to) return "outside";
  return !ranges || inRanges(day, ranges) ? "reading" : "gap";
}
/** Move From or To by whole days, staying inside bounds and keeping From <= To. null = no change. */
export function stepRange(
  range: Range,
  side: "from" | "to",
  delta: number,
  bounds: Range,
): Range | null {
  const moved = clampDay(addDays(range[side], delta), bounds);
  const next =
    side === "from"
      ? { from: moved > range.to ? range.to : moved, to: range.to }
      : { from: range.from, to: moved < range.from ? range.from : moved };
  return next.from === range.from && next.to === range.to ? null : next;
}
/** Month shown by the calendar popover for a value (falls back to the bounds' end). */
export function viewMonth(value: string, bounds: Range): string {
  return (value && parseTypedDate(value) ? value : bounds.to).slice(0, 7);
}
/** YYYY-MM for every month from `bounds.from` to `bounds.to`, newest first. */
export function monthsBetween(bounds: Range): string[] {
  const out: string[] = [];
  let y = Number(bounds.to.slice(0, 4)),
    m = Number(bounds.to.slice(5, 7));
  const first = bounds.from.slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key < first) break;
    out.push(key);
    if (m === 1) {
      m = 12;
      y--;
    } else m--;
  }
  return out;
}
