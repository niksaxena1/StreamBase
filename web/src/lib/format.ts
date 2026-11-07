export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Intl.NumberFormat("en-US").format(n);
}

export type CurrencyDisplay = "USD" | "AED";

export const AED_PER_USD = 3.6725;

let currencyDisplay: CurrencyDisplay = "USD";

export function setCurrencyDisplay(next: CurrencyDisplay) {
  currencyDisplay = next === "AED" ? "AED" : "USD";
}

export function getCurrencyDisplay(): CurrencyDisplay {
  return currencyDisplay;
}

export function formatMoney(
  nUsd: number | null | undefined,
  opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  if (nUsd === null || nUsd === undefined) return "—";
  const n = Number(nUsd);
  if (!Number.isFinite(n)) return "—";

  const min = opts?.minimumFractionDigits ?? 2;
  const max = opts?.maximumFractionDigits ?? min;

  if (currencyDisplay === "AED") {
    return formatAedNumber(n, { minimumFractionDigits: min, maximumFractionDigits: max });
  }

  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(n);
}

function formatAedNumber(
  nUsd: number,
  opts: { minimumFractionDigits: number; maximumFractionDigits: number },
): string {
  const aed = nUsd * AED_PER_USD;
  // Use plain number formatting, and prefix with AED.
  // NOTE: The "new Dirham symbol" font approach (mapping to 'ê') is not reliably rendering
  // across all contexts, so we use an explicit currency prefix for correctness.
  const num = Intl.NumberFormat("en-US", {
    minimumFractionDigits: opts.minimumFractionDigits,
    maximumFractionDigits: opts.maximumFractionDigits,
  }).format(aed);
  return `AED ${num}`;
}

export function formatCompactMoney(
  nUsd: number,
  fallback: (nUsd: number) => string = (n) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
): string {
  try {
    if (currencyDisplay === "AED") {
      const aed = nUsd * AED_PER_USD;
      const num = new Intl.NumberFormat("en-US", {
        notation: "compact",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(aed);
      return `AED ${num}`;
    }

    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(nUsd);
  } catch {
    return fallback(nUsd);
  }
}

export function formatUsd(n: number | null | undefined): string {
  return formatMoney(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatUsd2(n: number | null | undefined): string {
  return formatMoney(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DISPLAY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Parse a bare `YYYY-MM-DD` (or the date part of an ISO timestamp) as a UTC date. Invalid -> null. */
function parseUtcDate(value: string | null | undefined): Date | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** "2026-11-06" (or ISO timestamp) -> "06 Nov 2026". UTC-safe. Empty/invalid -> "—". */
export function formatDisplayDate(iso: string | null | undefined): string {
  const d = parseUtcDate(iso);
  if (!d) {
    // Spotify release dates can be year-only ("2019") or year-month ("2019-05").
    const s = String(iso ?? "").trim();
    if (/^\d{4}$/.test(s)) return s;
    const ym = /^(\d{4})-(\d{2})$/.exec(s);
    if (ym && Number(ym[2]) >= 1 && Number(ym[2]) <= 12) return `${DISPLAY_MONTHS[Number(ym[2]) - 1]} ${ym[1]}`;
    return "—";
  }
  return `${pad2(d.getUTCDate())} ${DISPLAY_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2026-11-06" -> "06 Nov" (no year). UTC-safe. Empty/invalid -> "—". */
export function formatDisplayDayMonth(iso: string | null | undefined): string {
  const d = parseUtcDate(iso);
  if (!d) return "—";
  return `${pad2(d.getUTCDate())} ${DISPLAY_MONTHS[d.getUTCMonth()]}`;
}

function parseTimestamp(ts: string | number | Date | null | undefined): Date | null {
  if (ts === null || ts === undefined || ts === "") return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Timestamp -> "06 Nov 2026, 20:00 UTC". Empty/invalid -> "—". */
export function formatDisplayDateTimeUtc(ts: string | number | Date | null | undefined): string {
  const d = parseTimestamp(ts);
  if (!d) return "—";
  return `${pad2(d.getUTCDate())} ${DISPLAY_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** Timestamp -> "06 Nov, 20:00 UTC" (no year). Empty/invalid -> "—". */
export function formatDisplayDayMonthTimeUtc(ts: string | number | Date | null | undefined): string {
  const d = parseTimestamp(ts);
  if (!d) return "—";
  return `${pad2(d.getUTCDate())} ${DISPLAY_MONTHS[d.getUTCMonth()]}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** Display formatter for ISO dates ("06 Nov 2026"). Display only: use the raw ISO string for values/exports. */
export function formatDateISO(s: string | null | undefined): string {
  if (!s) return "—";
  const out = formatDisplayDate(s);
  // Unrecognised non-empty values are shown as-is (the old pass-through behaviour).
  return out === "—" ? s : out;
}

/**
 * Format an ISO date (`YYYY-MM-DD`) as `12 Apr 2019` (UTC-safe).
 * (Name kept for existing callers; the ordinal suffix is no longer shown.)
 */
export function formatDateOrdinalDMonYYYY(iso: string | null | undefined): string {
  return formatDisplayDate(iso);
}
