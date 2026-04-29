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

export function formatDateISO(s: string | null | undefined): string {
  if (!s) return "—";
  return s;
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  const mod10 = n % 10;
  if (mod10 === 1) return "st";
  if (mod10 === 2) return "nd";
  if (mod10 === 3) return "rd";
  return "th";
}

/**
 * Format an ISO date (`YYYY-MM-DD`) as `12th Apr 2019` (UTC-safe).
 */
export function formatDateOrdinalDMonYYYY(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return "—";

  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const month = Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(d);

  return `${day}${ordinalSuffix(day)} ${month} ${year}`;
}
