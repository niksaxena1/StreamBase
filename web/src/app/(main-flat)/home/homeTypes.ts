import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";

export type HomeDashboardSearchParams = {
  scope?: string;
  range?: string;
  daily?: string;
  xy_date?: string;
  start?: string;
  end?: string;
};

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

/** Row from `home_artificial_stream_spikes` RPC (run date in `date`). */
export type ArtificialStreamSpikeRow = {
  isrc: string;
  name: string;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
  date: string;
  daily_streams: number;
  avg_same_dow: number | null;
  spike_ratio: number | null;
  streams_cumulative: number;
};

/** Props assembled on the server for `HomeDashboardClient`. */
export type HomeDashboardServerProps = {
  sp: HomeDashboardSearchParams;
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterErrorMessage?: string | null;
  trackScatterDataDate: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
  overrideAnnotations?: ManualOverrideAnnotation[];
  artistWeekendDips: ArtistWeekendDipRow[];
  trackWeekendDips: TrackWeekendDipRow[];
  negativeDailyStreams: NegativeDailyStreamsRow[];
  artificialStreamSpikes: ArtificialStreamSpikeRow[];
  artificialStreamSpikeRatio: number;
  artificialMinBaseline: number;
  artificialIncludeWeekends: boolean;
  /** When set (custom Home date range), spike RPC only uses rows in this window. */
  artificialSpikeDateStart: string | null;
  artificialSpikeDateEnd: string | null;
};
