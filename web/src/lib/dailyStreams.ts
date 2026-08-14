/**
 * Daily-stream derivation shared by Home and Playlists.
 *
 * Own catalog: daily = today's cumulative − yesterday's cumulative. The roster is
 * stable, so the diff is the real day-over-day movement.
 *
 * Competitor: the cumulative total jumps whenever a playlist is first tracked or a
 * previously missing track total is backfilled, which would report a track's entire
 * lifetime streams as one day's growth. The stored `daily_streams_net` is computed
 * per-track and membership-aware (see
 * migrations/add_competitor_playlist_stats_recompute.sql), so it is the correct source.
 */

/** Minimal row shape; both Home and Playlists row types satisfy it structurally. */
export type DailyStreamSourceRow = {
  total_streams_cumulative: number | null;
  daily_streams_net?: number | null;
};

function safeNum(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @param rowsDesc History rows, newest first.
 * @returns One value per row (newest first). Own-catalog's oldest row is `null`
 *   because it has no predecessor to diff against.
 */
export function dailyStreamValuesForDataset(
  rowsDesc: DailyStreamSourceRow[],
  datasetMode: "own" | "competitor",
): Array<number | null> {
  if (datasetMode === "competitor") {
    return rowsDesc.map((row) => safeNum(row.daily_streams_net));
  }

  return rowsDesc.map((row, index) => {
    if (index >= rowsDesc.length - 1) return null;
    return safeNum(row.total_streams_cumulative) - safeNum(rowsDesc[index + 1]?.total_streams_cumulative);
  });
}

/**
 * Trailing average of the most recent `windowDays` daily values, skipping nulls.
 * Returns null when there is nothing to average.
 */
export function trailingDailyAverage(
  values: Array<number | null>,
  windowDays = 7,
): number | null {
  const usable = values.filter((v): v is number => v != null).slice(0, windowDays);
  if (!usable.length) return null;
  return usable.reduce((sum, v) => sum + v, 0) / usable.length;
}
