export type TestDailyRow = {
  date: string;
  daily: number | null;
  total: number | null;
  track_count: number | null;
};

export type TestRunRow = {
  run_date: string;
  status: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type TestPlaylistLabel = {
  playlist_key: string;
  display_name: string;
};
