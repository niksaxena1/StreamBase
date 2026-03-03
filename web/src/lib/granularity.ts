import type { Granularity } from "@/components/ui/GranularitySelect";

/** Parse an ISO date string to noon-UTC to avoid timezone day-shifting. */
function isoToNoonUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function getQuarter(date: Date): { year: number; quarter: number } {
  return { year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1 };
}

function dateToBucketKey(dateStr: string, granularity: Granularity): string {
  const date = isoToNoonUtc(dateStr);
  switch (granularity) {
    case "weekly": {
      const { year, week } = getISOWeek(date);
      return `${year}-W${String(week).padStart(2, "0")}`;
    }
    case "monthly":
      return dateStr.substring(0, 7);
    case "quarterly": {
      const { year, quarter } = getQuarter(date);
      return `Q${quarter} ${year}`;
    }
    case "yearly":
      return dateStr.substring(0, 4);
    default:
      return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Generic sum-per-bucket aggregator (used by both daily-series and chart-point
// shapes so we don't duplicate the bucket logic).
// ---------------------------------------------------------------------------

function aggregateSumByBucket<T extends { date: string }>(
  data: T[],
  granularity: Granularity,
  getValue: (item: T) => number | null,
  buildResult: (key: string, sum: number | null, isPartial: boolean, bucketDays: number) => T,
): T[] {
  if (!data.length) return [];

  const bucketMap = new Map<string, { sum: number; count: number }>();
  const bucketOrder: string[] = [];
  const bucketDateCounts = new Map<string, number>();

  for (const point of data) {
    const key = dateToBucketKey(point.date, granularity);
    const v = getValue(point);
    const existing = bucketMap.get(key);
    if (existing) {
      if (v != null) {
        existing.sum += v;
        existing.count++;
      }
    } else {
      bucketMap.set(key, { sum: v ?? 0, count: v != null ? 1 : 0 });
      bucketOrder.push(key);
    }
    bucketDateCounts.set(key, (bucketDateCounts.get(key) ?? 0) + 1);
  }

  const expectedDays = expectedDaysInBucket(granularity);

  return bucketOrder.map((key, idx) => {
    const bucket = bucketMap.get(key)!;
    const daysPresent = bucketDateCounts.get(key) ?? 0;
    const partial = idx === 0 && daysPresent < expectedDays;

    return buildResult(
      key,
      bucket.count > 0 ? bucket.sum : null,
      partial,
      daysPresent,
    );
  });
}

function expectedDaysInBucket(granularity: Granularity): number {
  switch (granularity) {
    case "weekly":
      return 7;
    case "monthly":
      return 28;
    case "quarterly":
      return 89;
    case "yearly":
      return 365;
    default:
      return 1;
  }
}

/**
 * Post-process: add _growthPct to each item by comparing to the next item
 * (data is descending / newest-first, so "previous period" is index + 1).
 */
function addGrowthPct<T>(items: T[], getValue: (item: T) => number | null): (T & { _growthPct?: number | null })[] {
  return items.map((item, idx) => {
    const cur = getValue(item);
    const prev = idx < items.length - 1 ? getValue(items[idx + 1]) : null;
    let pct: number | null = null;
    if (cur != null && prev != null && prev !== 0) {
      pct = ((cur - prev) / Math.abs(prev)) * 100;
    }
    return { ...item, _growthPct: pct };
  });
}

/**
 * Aggregate a cumulative series by granularity.
 * Takes the last (most recent) value per bucket since cumulative values grow monotonically.
 * Input should be in descending date order (newest first); output preserves that order.
 */
export function aggregateCumulativeSeries(
  data: Array<{ date: string; value: number }>,
  granularity: Granularity,
): Array<{ date: string; value: number; _isPartial?: boolean; _bucketDays?: number }> {
  if (granularity === "daily") return data;
  if (!data.length) return [];

  const bucketMap = new Map<string, { date: string; value: number }>();
  const bucketOrder: string[] = [];
  const bucketDateCounts = new Map<string, number>();

  for (const point of data) {
    const key = dateToBucketKey(point.date, granularity);
    if (!bucketMap.has(key)) {
      bucketMap.set(key, { date: key, value: point.value });
      bucketOrder.push(key);
    }
    bucketDateCounts.set(key, (bucketDateCounts.get(key) ?? 0) + 1);
  }

  const expected = expectedDaysInBucket(granularity);

  return bucketOrder.map((key, idx) => {
    const entry = bucketMap.get(key)!;
    const daysPresent = bucketDateCounts.get(key) ?? 0;
    return {
      ...entry,
      _isPartial: idx === 0 && daysPresent < expected,
      _bucketDays: daysPresent,
    };
  });
}

/**
 * Aggregate a daily delta series by granularity.
 * Sums daily values within each bucket. MA7 is dropped for non-daily.
 * Input should be in descending date order (newest first); output preserves that order.
 */
export function aggregateDailySeries(
  data: Array<{ date: string; daily: number | null; ma7?: number | null }>,
  granularity: Granularity,
): Array<{ date: string; daily: number | null; ma7?: number | null; daily_avg?: number | null; _isPartial?: boolean; _bucketDays?: number; _growthPct?: number | null }> {
  if (granularity === "daily") return data;

  const results = aggregateSumByBucket(
    data,
    granularity,
    (item) => item.daily,
    (key, sum, partial, bucketDays) => ({
      date: key,
      daily: sum,
      daily_avg: sum != null && bucketDays > 0 ? Math.round(sum / bucketDays) : null,
      ...(partial ? { _isPartial: true } : {}),
      _bucketDays: bucketDays,
    }),
  );

  return addGrowthPct(results, (r) => r.daily);
}

/**
 * Aggregate ChartPoint-style data ({ date, value }) representing daily deltas.
 * Sums values within each bucket.
 * Input should be in descending date order; output preserves that order.
 */
export function aggregateChartPoints(
  data: Array<{ date: string; value: number | null; ma7?: number | null }>,
  granularity: Granularity,
): Array<{ date: string; value: number | null; ma7?: number | null; daily_avg?: number | null; _isPartial?: boolean; _bucketDays?: number; _growthPct?: number | null }> {
  if (granularity === "daily") return data;

  const results = aggregateSumByBucket(
    data,
    granularity,
    (item) => item.value,
    (key, sum, partial, bucketDays) => ({
      date: key,
      value: sum,
      daily_avg: sum != null && bucketDays > 0 ? Math.round(sum / bucketDays) : null,
      ...(partial ? { _isPartial: true } : {}),
      _bucketDays: bucketDays,
    }),
  );

  return addGrowthPct(results, (r) => r.value);
}
