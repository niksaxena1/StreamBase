export type DailyDomain = [number, number];

function finite(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function percentile(sorted: number[], p: number): number {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

/** Robust bounds of the visible daily points; the entire visible MA and zero stay in range. */
export function typicalDailyDomain(
  daily: ReadonlyArray<number | null | undefined>,
  movingAverage: ReadonlyArray<number | null | undefined> = [],
): DailyDomain {
  const sorted = finite(daily).sort((a, b) => a - b);
  const ma = finite(movingAverage);
  if (!sorted.length && !ma.length) return [0, 1];
  const low = Math.min(0, ...(sorted.length ? [percentile(sorted, 0.02)] : []), ...ma);
  const high = Math.max(0, ...(sorted.length ? [percentile(sorted, 0.98)] : []), ...ma);
  const pad = Math.max(1, (high - low) * 0.1);
  return [low - pad, high + pad];
}

export function clipDailyValue(value: number | null | undefined, domain: DailyDomain) {
  if (value == null || !Number.isFinite(value)) return { value: null, clipped: null };
  if (value < domain[0]) return { value: domain[0], clipped: "low" as const };
  if (value > domain[1]) return { value: domain[1], clipped: "high" as const };
  return { value, clipped: null };
}

export function formatClippedDailyValue(value: number): string {
  const magnitude = Math.abs(value);
  const [divisor, suffix] = magnitude >= 1e9 ? [1e9, "B"] : magnitude >= 1e6 ? [1e6, "M"] : magnitude >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${value < 0 ? "−" : ""}${Number((magnitude / divisor).toFixed(1))}${suffix}`;
}
