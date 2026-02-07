export const DEFAULT_MIN_MILESTONE_STREAMS = 100_000;
export const DEFAULT_AUTO_MILESTONE_TARGET_COUNT = 30;

const POSSIBLE_MILESTONES_DESC: number[] = [
  // Billions
  10_000_000_000, 5_000_000_000, 2_000_000_000, 1_000_000_000,
  // Hundreds of millions
  500_000_000, 400_000_000, 300_000_000, 200_000_000, 100_000_000,
  // Tens of millions
  50_000_000, 45_000_000, 40_000_000, 35_000_000, 30_000_000,
  25_000_000, 20_000_000, 19_000_000, 18_000_000, 17_000_000,
  16_000_000, 15_000_000, 14_000_000, 13_000_000, 12_000_000,
  11_000_000, 10_000_000, 9_000_000, 8_000_000, 7_000_000,
  6_000_000, 5_000_000, 4_500_000, 4_000_000, 3_500_000,
  3_000_000, 2_500_000, 2_000_000, 1_500_000, 1_000_000,
  // Hundreds of thousands
  900_000, 800_000, 750_000, 700_000, 600_000, 500_000,
  400_000, 300_000, 250_000, 200_000, 150_000, 100_000,
];

/**
 * Generate nice round milestone thresholds based on the max stream count observed.
 * Returns milestones in descending order (highest first).
 */
export function generateAutoMilestonesFromMax(
  maxStreams: number,
  opts?: { targetCount?: number; minMilestone?: number },
): number[] {
  const minMilestone = opts?.minMilestone ?? DEFAULT_MIN_MILESTONE_STREAMS;
  const targetCount = opts?.targetCount ?? DEFAULT_AUTO_MILESTONE_TARGET_COUNT;

  if (!Number.isFinite(maxStreams) || maxStreams <= 0) return [];

  const relevant = POSSIBLE_MILESTONES_DESC.filter((m) => m <= maxStreams && m >= minMilestone);
  if (!relevant.length) return [];
  if (relevant.length <= targetCount) return relevant;

  // Take every Nth milestone to get roughly targetCount
  const step = Math.ceil(relevant.length / targetCount);
  const thinned: number[] = [];
  for (let i = 0; i < relevant.length; i += step) {
    thinned.push(relevant[i]);
  }

  // Always include the smallest milestone if we have data
  const smallest = relevant[relevant.length - 1];
  if (smallest && !thinned.includes(smallest)) thinned.push(smallest);

  return thinned;
}

/**
 * Format milestone number as a compact label (e.g., "50M", "100K").
 * Useful for both UI labels (uppercase) and user inputs (lowercase).
 */
export function formatMilestoneCompact(n: number, opts?: { case?: "upper" | "lower" }): string {
  const c = opts?.case ?? "upper";
  const abs = Math.abs(n);

  const withSuffix = (value: number, suffix: string) => {
    const s = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
    const suf = c === "lower" ? suffix.toLowerCase() : suffix.toUpperCase();
    return `${s}${suf}`;
  };

  if (abs >= 1_000_000_000) return withSuffix(n / 1_000_000_000, "B");
  if (abs >= 1_000_000) return withSuffix(n / 1_000_000, "M");
  if (abs >= 1_000) return withSuffix(n / 1_000, "K");

  return Intl.NumberFormat("en-US").format(n);
}

