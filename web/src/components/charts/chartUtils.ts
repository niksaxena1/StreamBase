import { AED_PER_USD, getCurrencyDisplay } from "@/lib/format";

export type ManualOverrideTooltipItem = {
  note: string;
  title?: string;
  imageUrl?: string | null;
};

export const DEFAULT_CHART_START_DATE_ISO = "2026-01-28";

export function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isoDateToNoonUtc(dateString: string): Date {
  // Using noon UTC avoids local timezone shifting the calendar date.
  const [y, m, d] = dateString.split("-").map((x) => Number(x));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0));
}

export function normalizeIsoDateOrNull(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!isIsoDateString(s)) return null;
  return s;
}

/**
 * Filter a daily time series by an inclusive start date (YYYY-MM-DD).
 * Keeps the original order of `data` (newest-first or oldest-first).
 */
export function filterDailySeriesFromIsoDate<T extends { date: string }>(
  data: T[],
  startDateIso?: string | null,
): T[] {
  const start = normalizeIsoDateOrNull(startDateIso) ?? null;
  if (!start) return data;

  // Fast path: ISO date strings can be compared lexicographically.
  return (data ?? []).filter((d) => {
    const ds = String(d?.date ?? "");
    if (isIsoDateString(ds)) return ds >= start;
    const dt = new Date(ds);
    if (!Number.isFinite(dt.getTime())) return true; // don't drop unknown formats
    const startDt = isoDateToNoonUtc(start);
    return dt.getTime() >= startDt.getTime();
  });
}

/**
 * Filter a monthly series (`YYYY-MM`) using a daily start date (`YYYY-MM-DD`).
 * Includes the month containing the start date (e.g. start=2026-01-28 includes 2026-01).
 */
export function filterMonthlySeriesFromIsoDate<T extends { month: string }>(
  data: T[],
  startDateIso?: string | null,
): T[] {
  const start = normalizeIsoDateOrNull(startDateIso) ?? null;
  if (!start) return data;
  const startMonth = start.slice(0, 7); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return data;

  return (data ?? []).filter((d) => {
    const m = String(d?.month ?? "").trim();
    return /^\d{4}-\d{2}$/.test(m) ? m >= startMonth : true;
  });
}

export type ChartBucketGranularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export function computePaddedDomain(values: Array<number | null | undefined>, opts?: {
  /** Padding as a fraction of (max-min). Default: 0.08 (8%). */
  padRatio?: number;
  /** If true, clamps the domain min to 0 (useful for strictly-nonnegative series). Default: false. */
  clampMinToZero?: boolean;
  /** Minimum absolute padding to apply when range is tiny. Default: 1. */
  minAbsPad?: number;
}): [number, number] | undefined {
  const cleaned = (values ?? []).map((v) => (v == null ? null : Number(v))).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!cleaned.length) return undefined;
  if (cleaned.length === 1) {
    const v = cleaned[0];
    const pad = Math.max(opts?.minAbsPad ?? 1, Math.abs(v) * 0.05);
    const mn = (opts?.clampMinToZero ?? false) ? Math.max(0, v - pad) : v - pad;
    return [mn, v + pad];
  }

  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);
  const range = Math.max(0, max - min);
  const padRatio = opts?.padRatio ?? 0.08;
  const minAbsPad = opts?.minAbsPad ?? 1;
  const pad = Math.max(minAbsPad, range * padRatio, Math.max(Math.abs(min), Math.abs(max)) * 0.002);

  const mn = (opts?.clampMinToZero ?? false) ? Math.max(0, min - pad) : (min - pad);
  const mx = max + pad;
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) return undefined;
  if (mn === mx) return [mn - minAbsPad, mx + minAbsPad];
  return [mn, mx];
}

function isoDateToIsoWeekKey(dateIso: string): string | null {
  // Returns ISO week key like "2026-W05" (zero-padded).
  if (!isIsoDateString(dateIso)) return null;
  const d = isoDateToNoonUtc(dateIso);
  // ISO week date: set to nearest Thursday.
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 12, 0, 0));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const y = d.getUTCFullYear();
  const w = String(weekNo).padStart(2, "0");
  return `${y}-W${w}`;
}

function isoDateToQuarterKey(dateIso: string): { year: number; q: number } | null {
  if (!isIsoDateString(dateIso)) return null;
  const [y, m] = dateIso.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const q = Math.floor((m - 1) / 3) + 1;
  return { year: y, q };
}

export function filterBucketedSeriesFromIsoDate<T extends { date: string }>(
  data: T[],
  granularity: ChartBucketGranularity,
  startDateIso?: string | null,
): T[] {
  const start = normalizeIsoDateOrNull(startDateIso) ?? null;
  if (!start) return data;

  if (granularity === "daily") {
    return filterDailySeriesFromIsoDate(data, start);
  }

  if (granularity === "weekly") {
    const startKey = isoDateToIsoWeekKey(start);
    if (!startKey) return data;
    return (data ?? []).filter((d) => {
      const key = String(d?.date ?? "");
      return /^\d{4}-W\d{2}$/.test(key) ? key >= startKey : true;
    });
  }

  if (granularity === "monthly") {
    const startMonth = start.slice(0, 7);
    return (data ?? []).filter((d) => {
      const key = String(d?.date ?? "");
      return /^\d{4}-\d{2}$/.test(key) ? key >= startMonth : true;
    });
  }

  if (granularity === "yearly") {
    const startYear = Number(start.slice(0, 4));
    if (!Number.isFinite(startYear)) return data;
    return (data ?? []).filter((d) => {
      const key = String(d?.date ?? "");
      const y = Number(key);
      return /^\d{4}$/.test(key) && Number.isFinite(y) ? y >= startYear : true;
    });
  }

  // quarterly: keys like "Q1 2024"
  const sq = isoDateToQuarterKey(start);
  if (!sq) return data;
  return (data ?? []).filter((d) => {
    const key = String(d?.date ?? "");
    const m = key.match(/^Q([1-4])\s+(\d{4})$/);
    if (!m) return true;
    const q = Number(m[1]);
    const y = Number(m[2]);
    if (!Number.isFinite(q) || !Number.isFinite(y)) return true;
    return y > sq.year || (y === sq.year && q >= sq.q);
  });
}

function getOrdinalSuffix(n: number): string {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return "st";
  if (j === 2 && k !== 12) return "nd";
  if (j === 3 && k !== 13) return "rd";
  return "th";
}

export function formatTooltipDateDaily(dateString: string): string {
  const date = isIsoDateString(dateString) ? isoDateToNoonUtc(dateString) : new Date(dateString);
  const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();
  return `${dayOfWeek}, ${day}${getOrdinalSuffix(day)} ${month} ${year}`;
}

export function formatUsdCompact(n: number, fallback: (n: number) => string): string {
  // NOTE: Despite the name, this is the shared "money compact" formatter for charts.
  // It respects the global currency display mode (USD vs AED) since we store money in USD.
  try {
    const mode = getCurrencyDisplay();
    if (mode === "AED") {
      const aed = n * AED_PER_USD;
      const num = new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(aed);
      return `AED ${num}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return fallback(n);
  }
}

export function formatKmbTick(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000000000) {
    const billions = n / 1000000000;
    return `${billions % 1 === 0 ? billions.toFixed(0) : billions.toFixed(1)}B`;
  } else if (abs >= 1000000) {
    const millions = n / 1000000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  } else if (abs >= 1000) {
    const thousands = n / 1000;
    return `${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return new Intl.NumberFormat("en-US").format(n);
}

export function showCopiedToast(message: string) {
  try {
    const existing = document.getElementById("sb-copied-toast");
    if (existing) existing.remove();

    const notification = document.createElement("div");
    notification.id = "sb-copied-toast";
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: #22c55e;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
  } catch {
    // ignore toast failures
  }
}

export function extractOverrideItemsFromRechartsPayload(payload: unknown): ManualOverrideTooltipItem[] | null {
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0];
  if (!first || typeof first !== "object") return null;
  const firstObj = first as Record<string, unknown>;
  const inner = firstObj.payload;
  if (!inner || typeof inner !== "object") return null;
  const innerObj = inner as Record<string, unknown>;
  const items = innerObj._overrideItems;
  if (!Array.isArray(items) || items.length === 0) return null;

  return items
    .filter((it) => it && typeof it === "object" && typeof (it as Record<string, unknown>).note === "string")
    .map((it) => {
      const obj = it as Record<string, unknown>;
      return {
        note: String(obj.note),
        title: obj.title ? String(obj.title) : undefined,
        imageUrl:
          obj.imageUrl === null || typeof obj.imageUrl === "string"
            ? (obj.imageUrl as string | null)
            : null,
      };
    });
}

// ============================================================================
// Chart Downsampling (for long date ranges)
// ============================================================================

/**
 * Downsample a daily chart series to keep the total point count manageable.
 * Preserves first/last points and min/max within each bucket so visual
 * peaks and valleys are never hidden.
 *
 * Strategy:
 *   - ≤ maxPoints  → pass through unchanged
 *   - > maxPoints  → bucket into `maxPoints` windows; pick the point with
 *     the largest absolute `value` (or `daily`) in each bucket plus the
 *     bucket boundaries, then dedupe.
 *
 * Works on both ascending and descending arrays.
 * The output preserves the original ordering.
 */
export function downsampleSeries<T extends { date: string; value?: number | null; daily?: number | null }>(
  data: T[],
  maxPoints = 400,
): T[] {
  if (!data || data.length <= maxPoints) return data;

  const bucketSize = data.length / maxPoints;
  const kept = new Set<number>(); // indices to keep
  kept.add(0);
  kept.add(data.length - 1);

  for (let b = 0; b < maxPoints; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(Math.floor((b + 1) * bucketSize), data.length);

    let bestIdx = start;
    let bestAbs = -1;
    for (let i = start; i < end; i++) {
      const v = Math.abs(Number(data[i].value ?? data[i].daily ?? 0));
      if (v > bestAbs) {
        bestAbs = v;
        bestIdx = i;
      }
    }
    kept.add(start); // bucket boundary
    kept.add(bestIdx); // peak within bucket
  }

  const sortedIndices = Array.from(kept).sort((a, b) => a - b);
  return sortedIndices.map((i) => data[i]);
}

// ============================================================================
// Rolling Average Utilities
// ============================================================================

/**
 * Compute 7-day rolling average for time series data.
 * Input: array in descending order (newest first) with { date, value }.
 * Output: array in descending order with { date, value, ma7 }.
 */
export function computeRollingAvg7<T extends { date: string; value: number | null | undefined }>(
  desc: T[]
): Array<T & { ma7: number | null }> {
  const asc = [...desc].reverse();
  const outAsc: Array<T & { ma7: number | null }> = [];
  
  for (let i = 0; i < asc.length; i++) {
    const windowStart = Math.max(0, i - 6);
    let sum = 0;
    let count = 0;
    for (let j = windowStart; j <= i; j++) {
      const v = Number((asc[j] as any).value);
      if (!Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    // Strict MA7: only show once we have a full 7 valid points.
    outAsc.push({ ...asc[i], ma7: count === 7 ? sum / 7 : null });
  }
  
  return outAsc.reverse();
}

/**
 * Compute 7-day rolling average for daily data (using 'daily' field).
 * Input: array in descending order (newest first) with { date, daily }.
 * Output: array in descending order with { date, daily, ma7 }.
 */
export function computeDailyRollingAvg7<T extends { date: string; daily: number | null | undefined }>(
  desc: T[]
): Array<T & { ma7: number | null }> {
  const asc = [...desc].reverse();
  const outAsc: Array<T & { ma7: number | null }> = [];
  
  for (let i = 0; i < asc.length; i++) {
    const windowStart = Math.max(0, i - 6);
    let sum = 0;
    let count = 0;
    for (let j = windowStart; j <= i; j++) {
      const v = Number((asc[j] as any).daily);
      if (!Number.isFinite(v)) continue;
      sum += v;
      count += 1;
    }
    // Strict MA7: only show once we have a full 7 valid points.
    outAsc.push({ ...asc[i], ma7: count === 7 ? sum / 7 : null });
  }
  
  return outAsc.reverse();
}

// ============================================================================
// Calendar / Styling helpers (e.g. Sunday highlighting)
// ============================================================================

export type WeekdayIndexUtc = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function normalizeWeekdayIndexUtc(n: unknown, fallback: WeekdayIndexUtc): WeekdayIndexUtc {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  const i = Math.trunc(v);
  if (i === 0 || i === 1 || i === 2 || i === 3 || i === 4 || i === 5 || i === 6) return i;
  return fallback;
}

export function isWeekdayDateUtc(dateString: string, weekdayUtc: WeekdayIndexUtc): boolean {
  const date = isIsoDateString(dateString) ? isoDateToNoonUtc(dateString) : new Date(dateString);
  // getUTCDay is stable for noon UTC dates, and avoids local TZ surprises.
  return date.getUTCDay() === weekdayUtc;
}

export function isSundayDate(dateString: string): boolean {
  return isWeekdayDateUtc(dateString, 0);
}

/**
 * “Highlight day” helper for charts. Defaults to Sunday (0) for backwards compatibility.
 */
export function isHighlightDayDateUtc(dateString: string, highlightWeekdayUtc?: unknown): boolean {
  const weekday = normalizeWeekdayIndexUtc(highlightWeekdayUtc, 0);
  return isWeekdayDateUtc(dateString, weekday);
}

type RGBA = { r: number; g: number; b: number; a: number };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clamp255(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

function parseCssColor(input: string): RGBA | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  // #rgb, #rrggbb, #rrggbbaa
  if (s.startsWith("#")) {
    const h = s.slice(1);
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      return { r, g, b, a: 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a: clamp01(a) };
    }
    return null;
  }

  // rgb(...) / rgba(...)
  const m = s.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const a = m[4] == null ? 1 : Number(m[4]);
    if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
    return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) };
  }

  // Unknown formats (e.g. named colors) — return null so callers can fall back.
  return null;
}

function rgbaToCss({ r, g, b, a }: RGBA): string {
  const rr = clamp255(r);
  const gg = clamp255(g);
  const bb = clamp255(b);
  const aa = clamp01(a);
  return `rgba(${rr}, ${gg}, ${bb}, ${aa})`;
}

function mixRgb(a: RGBA, b: RGBA, t: number): RGBA {
  const tt = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * tt,
    g: a.g + (b.g - a.g) * tt,
    b: a.b + (b.b - a.b) * tt,
    a: 1,
  };
}

/**
 * Given a base series color, produce a subtly "faded/darker" variant to use on Sundays.
 * This is designed to follow metric toggles (streams/revenue/tracks) automatically.
 */
export function getSundayAccentColor(
  baseColor: string,
  opts?: { isDark?: boolean; bgColor?: string }
): string {
  const base = parseCssColor(baseColor);
  if (!base) return baseColor;

  const isDark = Boolean(opts?.isDark);
  const bgParsed = opts?.bgColor ? parseCssColor(opts.bgColor) : null;

  // In dark mode, mixing toward the actual background reads as "faded".
  // In light mode, mixing toward black reads as "slightly darker".
  const mixTarget = isDark ? (bgParsed ?? { r: 0, g: 0, b: 0, a: 1 }) : { r: 0, g: 0, b: 0, a: 1 };
  const t = isDark ? 0.42 : 0.22;
  const mixed = mixRgb(base, mixTarget, t);
  return rgbaToCss(mixed);
}

