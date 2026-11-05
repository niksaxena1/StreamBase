export type DeltaSnapshot = { date: string; follower_count: number | string };

function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Follower change over `days`, counted back from the playlist's newest snapshot date rather than
 * from today. The daily collector runs at 14:00 UTC, so counting from today made 1D read 0 for
 * every playlist until then (the newest count was compared with itself).
 */
export function deltaSince(
  rows: DeltaSnapshot[],
  latest: number | null,
  days: number,
  todayIso: string = new Date().toISOString().slice(0, 10),
): number | null {
  if (latest === null) return null;
  const anchor = rows.reduce<string | null>((max, row) => (max === null || row.date > max ? row.date : max), null);
  const target = shiftIsoDate(anchor ?? todayIso, days);
  const baseline = rows
    .filter((row) => row.date <= target)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!baseline) return null;
  return latest - Number(baseline.follower_count);
}
