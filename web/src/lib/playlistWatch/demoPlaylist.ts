/**
 * Deterministic follower history for the Playlist Watch demo row (MockWatchDemo00000001).
 * Overrides DB snapshots on the page so local/dev UI can be exercised without reseeding Supabase.
 */

export const PLAYLIST_WATCH_DEMO_PLAYLIST_ID = "MockWatchDemo00000001";

/** Shown in the playlist modal when the demo row has no `image_url` in the DB. */
export const PLAYLIST_WATCH_DEMO_IMAGE_URL = "/favicon-dark.ico";

export const PLAYLIST_WATCH_DEMO_OWNER_NAME = "StreamBase Demo";

export type DemoFollowerSnapshot = {
  date: string;
  spotify_playlist_id: string;
  follower_count: number;
};

/** Daily totals May 8–22, 2026; includes several day-over-day drops for chart QA. */
const DEMO_FOLLOWER_TOTALS: ReadonlyArray<{ date: string; follower_count: number }> = [
  { date: "2026-05-08", follower_count: 3800 },
  { date: "2026-05-09", follower_count: 3835 },
  { date: "2026-05-10", follower_count: 3810 },
  { date: "2026-05-11", follower_count: 3850 },
  { date: "2026-05-12", follower_count: 3828 },
  { date: "2026-05-13", follower_count: 3905 },
  { date: "2026-05-14", follower_count: 3920 },
  { date: "2026-05-15", follower_count: 4054 },
  { date: "2026-05-16", follower_count: 4090 },
  { date: "2026-05-17", follower_count: 4075 },
  { date: "2026-05-18", follower_count: 4120 },
  { date: "2026-05-19", follower_count: 4100 },
  { date: "2026-05-20", follower_count: 4180 },
  { date: "2026-05-21", follower_count: 4241 },
  { date: "2026-05-22", follower_count: 4280 },
];

export function isPlaylistWatchDemoPlaylistId(spotifyPlaylistId: string): boolean {
  return spotifyPlaylistId === PLAYLIST_WATCH_DEMO_PLAYLIST_ID;
}

export function getDemoFollowerSnapshots(): DemoFollowerSnapshot[] {
  return DEMO_FOLLOWER_TOTALS.map((row) => ({
    ...row,
    spotify_playlist_id: PLAYLIST_WATCH_DEMO_PLAYLIST_ID,
  }));
}

export function getDemoLatestFollowerCount(): number {
  return DEMO_FOLLOWER_TOTALS[DEMO_FOLLOWER_TOTALS.length - 1]?.follower_count ?? 0;
}
