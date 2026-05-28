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

export type TestSankeyRow = {
  group_key: string;
  group_name: string;
  playlist_key: string;
  playlist_name: string;
  isrc: string;
  track_name: string;
  artist_names: string[];
  value: number;
  total: number | null;
  daily: number | null;
};
