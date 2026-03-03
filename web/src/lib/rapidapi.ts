import { RAPIDAPI_RATE_LIMIT_MS } from "@/lib/constants";

export const RAPIDAPI_HOST =
  "spotify-track-streams-playback-count1.p.rapidapi.com";

export const RAPIDAPI_ENDPOINT = `https://${RAPIDAPI_HOST}/tracks/spotify_track_streams`;

// For consumers that don't want to import constants separately.
export const RAPIDAPI_DELAY_MS = RAPIDAPI_RATE_LIMIT_MS;

