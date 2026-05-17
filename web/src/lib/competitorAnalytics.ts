import type { PlaylistDailyStatsRow } from "@/app/(main-flat)/home/homeTypes";

export type CompetitorPlaylistHistoryRow = PlaylistDailyStatsRow & {
  playlist_key: string;
};

export function aggregateCompetitorPlaylistHistory(
  rows: CompetitorPlaylistHistoryRow[],
): PlaylistDailyStatsRow[] {
  const byDate = new Map<string, PlaylistDailyStatsRow>();

  for (const row of rows) {
    const existing =
      byDate.get(row.date) ??
      ({
        date: row.date,
        track_count: 0,
        total_streams_cumulative: 0,
        daily_streams_net: 0,
      } satisfies PlaylistDailyStatsRow);

    existing.track_count = Number(existing.track_count ?? 0) + Number(row.track_count ?? 0);
    existing.total_streams_cumulative =
      Number(existing.total_streams_cumulative ?? 0) + Number(row.total_streams_cumulative ?? 0);
    existing.daily_streams_net = Number(existing.daily_streams_net ?? 0) + Number(row.daily_streams_net ?? 0);

    byDate.set(row.date, existing);
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}
