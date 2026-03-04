export type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

export type ManualOverrideAnnotation = {
  date: string;
  note: string;
  title?: string;
  imageUrl?: string | null;
};

export type ChartPoint = { date: string; value: number | null; ma7?: number | null };

export type ArtistWeekendDipRow = {
  artist_id: string;
  artist_name: string | null;
  image_url: string | null;
  track_count: number;
  weekday_avg: number;
  sat_streams: number | null;
  sun_streams: number | null;
  sat_dip_pct: number | null;
  sun_dip_pct: number | null;
  avg_dip_pct: number | null;
};

export type TrackWeekendDipRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_name: string | null;
  weekday_avg: number;
  sat_streams: number | null;
  sun_streams: number | null;
  sat_dip_pct: number | null;
  sun_dip_pct: number | null;
  avg_dip_pct: number | null;
};

export type NegativeDailyStreamsRow = {
  isrc: string;
  name: string;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
  date: string;
  daily_streams_delta: number;
  total_streams_cumulative: number;
};
