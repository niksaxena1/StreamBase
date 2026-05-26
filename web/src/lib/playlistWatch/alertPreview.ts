import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";

export type AlertPreviewInput = {
  history: FollowerHistoryPoint[];
  minAbsoluteJump: number | null;
  minPercentJump: number | null;
  comparisonWindowDays: number;
};

export type AlertPreviewResult = {
  checkedDays: number;
  triggerCount: number;
  latestTrigger: {
    date: string;
    followers: number;
    baseline: number;
    absoluteJump: number;
    percentJump: number | null;
  } | null;
  needsMoreHistory: boolean;
};

export function buildAlertPreview(input: AlertPreviewInput): AlertPreviewResult {
  const windowDays = Math.max(1, Math.min(30, Math.round(input.comparisonWindowDays || 7)));
  const ordered = [...input.history].sort((a, b) => a.date.localeCompare(b.date));
  const triggers: NonNullable<AlertPreviewResult["latestTrigger"]>[] = [];
  let checkedDays = 0;

  for (let index = windowDays; index < ordered.length; index += 1) {
    const current = ordered[index];
    const baselineRows = ordered.slice(index - windowDays, index);
    if (!current || baselineRows.length < windowDays) continue;
    checkedDays += 1;
    const baseline = Math.round(
      baselineRows.reduce((sum, row) => sum + row.followers, 0) / baselineRows.length,
    );
    const absoluteJump = current.followers - baseline;
    const percentJump = baseline > 0 ? (absoluteJump / baseline) * 100 : null;
    if (input.minAbsoluteJump !== null && absoluteJump < input.minAbsoluteJump) continue;
    if (input.minPercentJump !== null && (percentJump === null || percentJump < input.minPercentJump)) continue;
    triggers.push({
      date: current.date,
      followers: current.followers,
      baseline,
      absoluteJump,
      percentJump,
    });
  }

  return {
    checkedDays,
    triggerCount: triggers.length,
    latestTrigger: triggers.at(-1) ?? null,
    needsMoreHistory: ordered.length <= windowDays,
  };
}
