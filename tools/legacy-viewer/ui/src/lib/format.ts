import { readNumberMode, type NumberMode } from "./numberMode";
const dash = "—";
const finite = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n);
export function fullNumber(n: number | null | undefined, digits = 0): string {
  return finite(n)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
        n,
      )
    : dash;
}
export function compactNumber(n: number | null | undefined): string {
  if (!finite(n)) return dash;
  for (const [scale, suffix] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const) {
    if (Math.abs(n) >= scale)
      return `${Number((n / scale).toFixed(1))}${suffix}`;
  }
  return fullNumber(n, 1);
}
/**
 * Number for display: exact (1,234,567) or compact (1.2M) per the app-wide toggle. Pure for a given
 * `mode`; the default reads the stored preference. Copy/CSV/aria text keeps using `fullNumber`.
 */
export function displayNumber(
  n: number | null | undefined,
  digits = 0,
  mode: NumberMode = readNumberMode(),
): string {
  return mode === "compact" ? compactNumber(n) : fullNumber(n, digits);
}
/** "+1.2M" / "−1,234" using the display mode (U+2212 minus, like the lookup difference). */
export function displaySigned(
  n: number | null | undefined,
  mode: NumberMode = readNumberMode(),
): string {
  if (!finite(n)) return dash;
  return `${n >= 0 ? "+" : "−"}${displayNumber(Math.abs(n), 0, mode)}`;
}
/** Hover text that always carries the exact value when the displayed one is compact. */
export function exactTitle(
  n: number | null | undefined,
  digits = 0,
  mode: NumberMode = readNumberMode(),
): string | undefined {
  return mode === "compact" && finite(n) ? fullNumber(n, digits) : undefined;
}
/** Chart/tooltip text: exact, or "1.2M · 1,234,567" in compact mode. */
export function tooltipNumber(
  n: number | null | undefined,
  digits = 0,
  mode: NumberMode = readNumberMode(),
): string {
  return mode === "compact" && finite(n)
    ? `${compactNumber(n)} · ${fullNumber(n, digits)}`
    : fullNumber(n, digits);
}
export function signedDelta(n: number | null | undefined): string {
  return finite(n) ? `${n > 0 ? "+" : ""}${fullNumber(n)}` : dash;
}
/** Percent inputs are fractions (0.42 = 42%). */
export function percent(n: number | null | undefined, digits = 1): string {
  return finite(n) ? `${fullNumber(n * 100, digits)}%` : dash;
}
export const DAY_MS = 86_400_000;
/** Timestamp without zone is UTC, matching the archive contract. */
export function utcDate(raw: string): Date {
  const zoned = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00Z`
    : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
      ? raw
      : `${raw.replace(" ", "T")}Z`;
  const date = new Date(zoned);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError(`Invalid UTC date: ${raw}`);
  return date;
}
export function dateKey(raw: string): string {
  return utcDate(raw).toISOString().slice(0, 10);
}
export function formatUtcDate(raw: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(raw));
}
export function weekStart(raw: string): string {
  const date = utcDate(dateKey(raw));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function monthBucket(raw: string): string {
  return dateKey(raw).slice(0, 7);
}
export function monthLabel(raw: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(raw.length === 7 ? `${raw}-01` : raw));
}
