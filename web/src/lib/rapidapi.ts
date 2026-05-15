import { RAPIDAPI_RATE_LIMIT_MS } from "@/lib/constants";

export type StreamLookupProvider =
  | "music_analytics"
  | "checkleakedcc"
  | "beat_analytics"
  | "music_metrics";

export const STREAM_LOOKUP_PROVIDER_LABELS: Record<StreamLookupProvider, string> = {
  music_analytics: "MusicAnalytics",
  checkleakedcc: "CheckLeakedCC",
  beat_analytics: "Beat Analytics",
  music_metrics: "Music Metrics",
};

export const STREAM_LOOKUP_PROVIDER_CAPS: Record<StreamLookupProvider, number> = {
  music_analytics: 50,
  checkleakedcc: 1000,
  beat_analytics: 50,
  music_metrics: 20,
};

export const STREAM_LOOKUP_PROVIDER_WINDOWS: Record<
  StreamLookupProvider,
  "daily" | "monthly"
> = {
  music_analytics: "monthly",
  checkleakedcc: "monthly",
  beat_analytics: "daily",
  music_metrics: "daily",
};

export const STREAM_LOOKUP_PROVIDER_DAILY_CAPS = {
  beat_analytics: STREAM_LOOKUP_PROVIDER_CAPS.beat_analytics,
  music_metrics: STREAM_LOOKUP_PROVIDER_CAPS.music_metrics,
} as const;

export const STREAM_LOOKUP_PROVIDER_MONTHLY_CAPS = {
  music_analytics: STREAM_LOOKUP_PROVIDER_CAPS.music_analytics,
  checkleakedcc: STREAM_LOOKUP_PROVIDER_CAPS.checkleakedcc,
} as const;

export const MUSIC_ANALYTICS_RAPIDAPI_HOST = "spotify-stream-count.p.rapidapi.com";

export const MUSIC_ANALYTICS_ENDPOINT = `https://${MUSIC_ANALYTICS_RAPIDAPI_HOST}/v1/spotify/tracks`;


export const CHECKLEAKEDCC_RAPIDAPI_HOST = "spotify81.p.rapidapi.com";

export const CHECKLEAKEDCC_ENDPOINT = `https://${CHECKLEAKEDCC_RAPIDAPI_HOST}/partner/track/count`;

export const BEAT_ANALYTICS_RAPIDAPI_HOST =
  "spotify-statistics-and-stream-count.p.rapidapi.com";

export const BEAT_ANALYTICS_ENDPOINT = `https://${BEAT_ANALYTICS_RAPIDAPI_HOST}/track`;

export const MUSIC_METRICS_RAPIDAPI_HOST =
  "spotify-track-streams-playback-count1.p.rapidapi.com";

export const MUSIC_METRICS_ENDPOINT = `https://${MUSIC_METRICS_RAPIDAPI_HOST}/tracks/spotify_track_streams`;

// For consumers that don't want to import constants separately.
export const RAPIDAPI_DELAY_MS = RAPIDAPI_RATE_LIMIT_MS;

