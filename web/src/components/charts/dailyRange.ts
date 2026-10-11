export type DailyDomain = [number, number];

function finite(values: ReadonlyArray<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Median ± 6 MAD rejects isolated outliers even in a 30-day window.
 * The 5% median floor keeps flat, non-zero series readable. Zero belongs in
 * the domain only when it is within these typical bounds (or their padding).
 * Moving averages are clipped separately, never used to widen the domain.
 */
export function typicalDailyDomain(
  daily: ReadonlyArray<number | null | undefined>,
): DailyDomain {
  const sorted = finite(daily).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const center = median(sorted);
  const deviations = sorted.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
  const radius = Math.max(1, 6 * Math.max(median(deviations), Math.abs(center) * 0.05));
  const low = center - radius;
  const high = center + radius;
  const pad = Math.max(1, (high - low) * 0.1);
  return [low - pad, high + pad];
}

export function clipDailyValue(value: number | null | undefined, domain: DailyDomain) {
  if (value == null || !Number.isFinite(value)) return { value: null, clipped: null };
  if (value < domain[0]) return { value: domain[0], clipped: "low" as const };
  if (value > domain[1]) return { value: domain[1], clipped: "high" as const };
  return { value, clipped: null };
}

/** Every clipped point gets a cap; one label per adjacent run, at its largest magnitude. */
export function clipDailySeries(values: ReadonlyArray<number | null | undefined>, domain: DailyDomain) {
  const points = values.map((value) => ({ ...clipDailyValue(value, domain), showLabel: false }));
  let largest: number | null = null;
  for (let index = 0; index <= points.length; index++) {
    if (points[index]?.clipped) {
      if (largest === null || Math.abs(values[index]!) > Math.abs(values[largest]!)) largest = index;
    } else if (largest !== null) {
      points[largest].showLabel = true;
      largest = null;
    }
  }
  return points;
}
