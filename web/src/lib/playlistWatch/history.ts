export type FollowerSnapshotLike = {
  date: string;
  follower_count: number;
};

export type FollowerHistoryPoint = {
  date: string;
  followers: number;
  dailyDelta: number | null;
};

export function buildFollowerHistory(rows: FollowerSnapshotLike[]): FollowerHistoryPoint[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((row, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    const followers = Number(row.follower_count);
    return {
      date: row.date,
      followers,
      dailyDelta: previous ? followers - Number(previous.follower_count) : null,
    };
  });
}
