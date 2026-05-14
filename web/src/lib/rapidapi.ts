import { RAPIDAPI_RATE_LIMIT_MS } from "@/lib/constants";

export type StreamLookupProvider = "beat_analytics" | "music_metrics";

export const STREAM_LOOKUP_PROVIDER_LABELS: Record<StreamLookupProvider, string> = {
  beat_analytics: "Beat Analytics",
  music_metrics: "Music Metrics",
};

export const BEAT_ANALYTICS_RAPIDAPI_HOST =
  "spotify-statistics-and-stream-count.p.rapidapi.com";

export const BEAT_ANALYTICS_ENDPOINT = `https://${BEAT_ANALYTICS_RAPIDAPI_HOST}/track`;

export const MUSIC_METRICS_RAPIDAPI_HOST =
  "spotify-track-streams-playback-count1.p.rapidapi.com";

export const MUSIC_METRICS_ENDPOINT = `https://${MUSIC_METRICS_RAPIDAPI_HOST}/tracks/spotify_track_streams`;

// For consumers that don't want to import constants separately.
export const RAPIDAPI_DELAY_MS = RAPIDAPI_RATE_LIMIT_MS;

