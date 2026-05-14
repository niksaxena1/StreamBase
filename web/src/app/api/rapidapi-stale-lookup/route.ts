import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import {
  BEAT_ANALYTICS_ENDPOINT,
  BEAT_ANALYTICS_RAPIDAPI_HOST,
  MUSIC_METRICS_ENDPOINT,
  MUSIC_METRICS_RAPIDAPI_HOST,
  RAPIDAPI_DELAY_MS,
  STREAM_LOOKUP_PROVIDER_LABELS,
  type StreamLookupProvider,
} from "@/lib/rapidapi";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type StaleLookupResult = {
  isrc: string;
  streams: number | null;
  status: "ok" | "failed" | "suspicious";
  provider?: StreamLookupProvider;
  providerLabel?: string;
  error?: string;
};

type ProviderLookup = {
  streams: number | null;
  provider: StreamLookupProvider;
  error?: string;
};

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const beatAnalyticsKey = (
    process.env.BEAT_ANALYTICS_RAPIDAPI_KEY ??
    process.env.RAPIDAPI_KEY ??
    ""
  ).trim();
  const musicMetricsKey = (
    process.env.MUSIC_METRICS_RAPIDAPI_KEY ??
    process.env.RAPIDAPI_KEY ??
    ""
  ).trim();
  if (!beatAnalyticsKey && !musicMetricsKey) {
    return apiJsonErr(
      "No stream lookup provider key is configured on the server",
      503,
    );
  }

  let isrcs: string[];
  let staleStreams: Record<string, number>;
  let spotifyTrackIds: Record<string, string>;
  try {
    const body = await readJsonBodyOptional(request);
    const raw = body.isrcs;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("isrcs must be a non-empty array");
    }
    isrcs = raw
      .map((v) => String(v ?? "").trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 20);
    if (isrcs.length === 0) throw new Error("No valid ISRCs provided");

    staleStreams = {};
    if (body.staleStreams && typeof body.staleStreams === "object") {
      for (const [k, v] of Object.entries(body.staleStreams as Record<string, unknown>)) {
        const n = Number(v);
        if (Number.isFinite(n)) staleStreams[k.trim().toUpperCase()] = n;
      }
    }

    spotifyTrackIds = {};
    if (body.spotifyTrackIds && typeof body.spotifyTrackIds === "object") {
      for (const [k, v] of Object.entries(body.spotifyTrackIds as Record<string, unknown>)) {
        const isrc = k.trim().toUpperCase();
        const spotifyTrackId = String(v ?? "").trim();
        if (isrc && spotifyTrackId) spotifyTrackIds[isrc] = spotifyTrackId;
      }
    }
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid request body", 400);
  }

  const results: StaleLookupResult[] = [];
  const delayMs = RAPIDAPI_DELAY_MS;

  for (let i = 0; i < isrcs.length; i++) {
    const isrc = isrcs[i];
    try {
      const lookup = await lookupStreams({
        isrc,
        spotifyTrackId: spotifyTrackIds[isrc],
        beatAnalyticsKey,
        musicMetricsKey,
      });

      if (lookup.streams == null) {
        results.push({
          isrc,
          streams: null,
          status: "failed",
          error: lookup.error ?? "No data from stream lookup providers",
        });
        continue;
      }

      const stale = staleStreams[isrc];
      const suspicious = stale != null && lookup.streams < stale;
      results.push({
        isrc,
        streams: lookup.streams,
        status: suspicious ? "suspicious" : "ok",
        provider: lookup.provider,
        providerLabel: STREAM_LOOKUP_PROVIDER_LABELS[lookup.provider],
      });
    } catch {
      results.push({ isrc, streams: null, status: "failed", error: "Request failed" });
    }

    if (i < isrcs.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return apiJsonOk({ results });
}

async function lookupStreams({
  isrc,
  spotifyTrackId,
  beatAnalyticsKey,
  musicMetricsKey,
}: {
  isrc: string;
  spotifyTrackId?: string;
  beatAnalyticsKey: string;
  musicMetricsKey: string;
}): Promise<ProviderLookup> {
  if (beatAnalyticsKey && spotifyTrackId) {
    try {
      const beat = await lookupBeatAnalytics(spotifyTrackId, beatAnalyticsKey);
      if (beat.streams != null) return beat;
    } catch {
      // Fall through to Music Metrics below.
    }
  }

  if (musicMetricsKey) {
    try {
      return await lookupMusicMetrics(isrc, musicMetricsKey);
    } catch {
      return {
        streams: null,
        provider: "music_metrics",
        error: "Music Metrics request failed",
      };
    }
  }

  return {
    streams: null,
    provider: "beat_analytics",
    error: spotifyTrackId
      ? "Beat Analytics returned no data and Music Metrics is not configured"
      : "Beat Analytics requires a Spotify track ID and Music Metrics is not configured",
  };
}

async function lookupBeatAnalytics(
  spotifyTrackId: string,
  apiKey: string,
): Promise<ProviderLookup> {
  const url = new URL(`${BEAT_ANALYTICS_ENDPOINT}/${encodeURIComponent(spotifyTrackId)}`);
  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-host": BEAT_ANALYTICS_RAPIDAPI_HOST,
      "x-rapidapi-key": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    streamCount?: number;
  };
  const streams = Number(payload.streamCount);
  return {
    streams: res.ok && Number.isFinite(streams) ? streams : null,
    provider: "beat_analytics",
    error: res.ok ? "No stream count from Beat Analytics" : "Beat Analytics request failed",
  };
}

async function lookupMusicMetrics(
  isrc: string,
  apiKey: string,
): Promise<ProviderLookup> {
  const url = new URL(MUSIC_METRICS_ENDPOINT);
  url.searchParams.set("isrc", isrc);
  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-host": MUSIC_METRICS_RAPIDAPI_HOST,
      "x-rapidapi-key": apiKey,
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    result?: string;
    streams?: number;
  };
  const streams = Number(payload.streams);
  return {
    streams: res.ok && payload.result === "success" && Number.isFinite(streams)
      ? streams
      : null,
    provider: "music_metrics",
    error: res.ok ? "No stream count from Music Metrics" : "Music Metrics request failed",
  };
}
