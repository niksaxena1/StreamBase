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

  const min = opts?.minimumFractionDigits ?? 0;
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

export function formatUsd(n: number | null | undefined): string {
  return formatMoney(n, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatUsd2(n: number | null | undefined): string {
  return formatMoney(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateISO(s: string | null | undefined): string {
  if (!s) return "—";
  return s;
}

