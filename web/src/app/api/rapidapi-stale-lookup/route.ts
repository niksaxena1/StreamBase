import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import {
  BEAT_ANALYTICS_ENDPOINT,
  BEAT_ANALYTICS_RAPIDAPI_HOST,
  CHECKLEAKEDCC_ENDPOINT,
  CHECKLEAKEDCC_RAPIDAPI_HOST,
  MUSIC_ANALYTICS_ENDPOINT,
  MUSIC_ANALYTICS_RAPIDAPI_HOST,
  MUSIC_METRICS_ENDPOINT,
  MUSIC_METRICS_RAPIDAPI_HOST,
  RAPIDAPI_DELAY_MS,
  STREAM_LOOKUP_PROVIDER_CAPS,
  STREAM_LOOKUP_PROVIDER_LABELS,
  STREAM_LOOKUP_PROVIDER_WINDOWS,
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

type LookupContext = "stale" | "missing_snapshot" | "prev_nonzero";

type ProviderLookup = {
  streams: number | null;
  provider: StreamLookupProvider;
  error?: string;
};

type ProviderQuota = {
  provider: StreamLookupProvider;
  providerLabel: string;
  window: "daily" | "monthly";
  cap: number;
  used: number;
  remaining: number;
  overageCalls: number;
  overageAllowed: boolean;
  overageUnitCostUsd: number | null;
};

type QuotaState = {
  date: string;
  configured: boolean;
  providers: Record<StreamLookupProvider, ProviderQuota>;
};

const memoryUsage = globalThis as typeof globalThis & {
  __spotibaseStreamLookupUsage?: Record<string, Partial<Record<StreamLookupProvider, number>>>;
};

export async function GET(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const quota = await loadQuotaState();
  const lookupDate = request.nextUrl.searchParams.get("date") ?? todayKey();
  const context = normalizeLookupContext(request.nextUrl.searchParams.get("context"));
  const results = await loadSavedLookupResults(lookupDate, context);
  return apiJsonOk({ quota, results });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const beatAnalyticsKey = (
    process.env.BEAT_ANALYTICS_RAPIDAPI_KEY ??
    process.env.RAPIDAPI_KEY ??
    ""
  ).trim();
  const musicAnalyticsKey = (
    process.env.MUSIC_ANALYTICS_RAPIDAPI_KEY ??
    process.env.RAPIDAPI_KEY ??
    ""
  ).trim();
  const checkLeakedCcKey = (
    process.env.CHECKLEAKEDCC_RAPIDAPI_KEY ??
    process.env.RAPIDAPI_KEY ??
    ""
  ).trim();
  const musicMetricsKey = (
    process.env.MUSIC_METRICS_RAPIDAPI_KEY ??
    process.env.RAPIDAPI_KEY ??
    ""
  ).trim();
  if (!musicAnalyticsKey && !checkLeakedCcKey && !beatAnalyticsKey && !musicMetricsKey) {
    return apiJsonErr(
      "No stream lookup provider key is configured on the server",
      503,
    );
  }

  let isrcs: string[];
  let staleStreams: Record<string, number>;
  let spotifyTrackIds: Record<string, string>;
  let allowMusicMetricsOverage = false;
  let preferredProvider: StreamLookupProvider | null = null;
  let context: LookupContext = "stale";
  try {
    const body = await readJsonBodyOptional(request);
    const raw = body.isrcs;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("isrcs must be a non-empty array");
    }
    isrcs = raw
      .map((v) => String(v ?? "").trim().toUpperCase())
      .filter(Boolean)
      .slice(
        0,
          STREAM_LOOKUP_PROVIDER_CAPS.checkleakedcc +
          STREAM_LOOKUP_PROVIDER_CAPS.music_analytics +
          STREAM_LOOKUP_PROVIDER_CAPS.beat_analytics +
          STREAM_LOOKUP_PROVIDER_CAPS.music_metrics,
      );
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
    allowMusicMetricsOverage = body.allowMusicMetricsOverage === true;
    preferredProvider = normalizeProvider(body.preferredProvider);
    context = normalizeLookupContext(body.context);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid request body", 400);
  }

  const results: StaleLookupResult[] = [];
  const delayMs = RAPIDAPI_DELAY_MS;
  const quota = await loadQuotaState();
  const remaining: Record<StreamLookupProvider, number> = {
    music_analytics: quota.providers.music_analytics.remaining,
    checkleakedcc: quota.providers.checkleakedcc.remaining,
    beat_analytics: quota.providers.beat_analytics.remaining,
    music_metrics: quota.providers.music_metrics.remaining,
  };

  for (let i = 0; i < isrcs.length; i++) {
    const isrc = isrcs[i];
    try {
      const lookup = await lookupStreams({
        isrc,
        spotifyTrackId: spotifyTrackIds[isrc],
        musicAnalyticsKey,
        checkLeakedCcKey,
        beatAnalyticsKey,
        musicMetricsKey,
        remaining,
        allowMusicMetricsOverage,
        preferredProvider,
      });

      if (lookup.streams == null) {
        const failedResult = {
          isrc,
          streams: null,
          status: "failed",
          provider: lookup.provider,
          providerLabel: STREAM_LOOKUP_PROVIDER_LABELS[lookup.provider],
          error: lookup.error ?? "No data from stream lookup providers",
        } satisfies StaleLookupResult;
        results.push(failedResult);
        await saveLookupResult(failedResult, staleStreams[isrc] ?? null, context);
        continue;
      }

      const stale = staleStreams[isrc];
      const suspicious = stale != null && lookup.streams < stale;
      const result = {
        isrc,
        streams: lookup.streams,
        status: suspicious ? "suspicious" : "ok",
        provider: lookup.provider,
        providerLabel: STREAM_LOOKUP_PROVIDER_LABELS[lookup.provider],
      } satisfies StaleLookupResult;
      results.push(result);
      await saveLookupResult(result, stale ?? null, context);
    } catch {
      const failedResult = { isrc, streams: null, status: "failed", error: "Request failed" } satisfies StaleLookupResult;
      results.push(failedResult);
    }

    if (i < isrcs.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return apiJsonOk({ results, quota: await loadQuotaState() });
}

async function loadSavedLookupResults(
  lookupDate: string,
  context: LookupContext,
): Promise<StaleLookupResult[]> {
  try {
    const svc = supabaseService();
    const { data: overrideRows } = await svc
      .from("track_daily_stream_overrides")
      .select("isrc")
      .eq("date", lookupDate)
      .limit(5000);
    const overriddenIsrcs = new Set(
      ((overrideRows ?? []) as Array<{ isrc?: string | null }>)
        .map((row) => String(row.isrc ?? "").trim().toUpperCase())
        .filter(Boolean),
    );
    const { data, error } = await svc
      .from("stream_lookup_results")
      .select("isrc,provider,streams,status,error")
      .eq("lookup_date", lookupDate)
      .eq("context", context);
    if (error) throw error;

    return ((data ?? []) as Array<{
      isrc?: string;
      provider?: StreamLookupProvider;
      streams?: number | null;
      status?: "ok" | "failed" | "suspicious";
      error?: string | null;
    }>)
      .filter((row) => row.isrc && row.status)
      .filter((row) => !overriddenIsrcs.has(String(row.isrc).trim().toUpperCase()))
      .map((row) => ({
        isrc: String(row.isrc).trim().toUpperCase(),
        streams: row.streams == null ? null : Number(row.streams),
        status: row.status!,
        provider: row.provider,
        providerLabel: row.provider ? STREAM_LOOKUP_PROVIDER_LABELS[row.provider] : undefined,
        error: row.error ?? undefined,
      }));
  } catch {
    return [];
  }
}

async function saveLookupResult(
  result: StaleLookupResult,
  staleStreams: number | null,
  context: LookupContext,
) {
  if (!result.provider) return;
  try {
    const svc = supabaseService();
    await svc.from("stream_lookup_results").upsert(
      [
        {
          lookup_date: todayKey(),
          context,
          isrc: result.isrc,
          provider: result.provider,
          streams: result.streams,
          status: result.status,
          error: result.error ?? null,
          stale_streams: staleStreams,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "lookup_date,context,isrc" },
    );
  } catch {
    // Best-effort cache: quota tracking still protects provider limits.
  }
}

function normalizeLookupContext(raw: unknown): LookupContext {
  return raw === "missing_snapshot" || raw === "prev_nonzero" ? raw : "stale";
}

function normalizeProvider(raw: unknown): StreamLookupProvider | null {
  return raw === "music_analytics" || raw === "checkleakedcc" || raw === "beat_analytics" || raw === "music_metrics"
    ? raw
    : null;
}

async function lookupStreams({
  isrc,
  spotifyTrackId,
  checkLeakedCcKey,
  musicAnalyticsKey,
  beatAnalyticsKey,
  musicMetricsKey,
  remaining,
  allowMusicMetricsOverage,
  preferredProvider,
}: {
  isrc: string;
  spotifyTrackId?: string;
  checkLeakedCcKey: string;
  musicAnalyticsKey: string;
  beatAnalyticsKey: string;
  musicMetricsKey: string;
  remaining: Record<StreamLookupProvider, number>;
  allowMusicMetricsOverage: boolean;
  preferredProvider: StreamLookupProvider | null;
}): Promise<ProviderLookup> {
  if (preferredProvider === "music_analytics") {
    if (!spotifyTrackId) {
      return { streams: null, provider: "music_analytics", error: "MusicAnalytics requires a Spotify track ID" };
    }
    if (!musicAnalyticsKey) {
      return { streams: null, provider: "music_analytics", error: "MusicAnalytics is not configured" };
    }
    if (remaining.music_analytics <= 0) {
      return { streams: null, provider: "music_analytics", error: "MusicAnalytics monthly quota is exhausted" };
    }
    remaining.music_analytics -= 1;
    await recordProviderCall("music_analytics");
    return lookupMusicAnalytics(spotifyTrackId, musicAnalyticsKey);
  }

  if (preferredProvider) {
    return lookupPreferredProvider({
      preferredProvider,
      isrc,
      spotifyTrackId,
      checkLeakedCcKey,
      musicAnalyticsKey,
      beatAnalyticsKey,
      musicMetricsKey,
      remaining,
      allowMusicMetricsOverage,
    });
  }

  if (beatAnalyticsKey && spotifyTrackId && remaining.beat_analytics > 0) {
    remaining.beat_analytics -= 1;
    await recordProviderCall("beat_analytics");
    try {
      const beat = await lookupBeatAnalytics(spotifyTrackId, beatAnalyticsKey);
      if (beat.streams != null) return beat;
    } catch {
      // Fall through to free Music Metrics below.
    }
  }

  if (musicMetricsKey && remaining.music_metrics > 0) {
    remaining.music_metrics -= 1;
    await recordProviderCall("music_metrics");
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

  if (musicAnalyticsKey && spotifyTrackId && remaining.music_analytics > 0) {
    remaining.music_analytics -= 1;
    await recordProviderCall("music_analytics");
    try {
      const musicAnalytics = await lookupMusicAnalytics(spotifyTrackId, musicAnalyticsKey);
      if (musicAnalytics.streams != null) return musicAnalytics;
    } catch {
      // Fall through to CheckLeakedCC below.
    }
  }

  if (checkLeakedCcKey && spotifyTrackId && remaining.checkleakedcc > 0) {
    remaining.checkleakedcc -= 1;
    await recordProviderCall("checkleakedcc");
    try {
      const checkLeakedCc = await lookupCheckLeakedCc(isrc, spotifyTrackId, checkLeakedCcKey);
      if (checkLeakedCc.streams != null) return checkLeakedCc;
    } catch {
      // Fall through to paid Music Metrics below.
    }
  }

  if (musicMetricsKey && allowMusicMetricsOverage) {
    remaining.music_metrics -= 1;
    await recordProviderCall("music_metrics");
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
    provider: "checkleakedcc",
    error:
      remaining.checkleakedcc <= 0 &&
      remaining.beat_analytics <= 0 &&
      remaining.music_metrics <= 0 &&
      !allowMusicMetricsOverage
      ? "Free stream lookup quota is exhausted"
      : spotifyTrackId
      ? "Spotify-ID providers returned no data and Music Metrics is not configured"
      : "Spotify-ID providers require a Spotify track ID and Music Metrics is not configured",
  };
}

async function lookupPreferredProvider({
  preferredProvider,
  isrc,
  spotifyTrackId,
  checkLeakedCcKey,
  musicAnalyticsKey,
  beatAnalyticsKey,
  musicMetricsKey,
  remaining,
  allowMusicMetricsOverage,
}: {
  preferredProvider: StreamLookupProvider;
  isrc: string;
  spotifyTrackId?: string;
  checkLeakedCcKey: string;
  musicAnalyticsKey: string;
  beatAnalyticsKey: string;
  musicMetricsKey: string;
  remaining: Record<StreamLookupProvider, number>;
  allowMusicMetricsOverage: boolean;
}): Promise<ProviderLookup> {
  if (preferredProvider === "checkleakedcc") {
    if (!spotifyTrackId) {
      return { streams: null, provider: "checkleakedcc", error: "CheckLeakedCC requires a Spotify track ID" };
    }
    if (!checkLeakedCcKey) {
      return { streams: null, provider: "checkleakedcc", error: "CheckLeakedCC is not configured" };
    }
    if (remaining.checkleakedcc <= 0) {
      return { streams: null, provider: "checkleakedcc", error: "CheckLeakedCC monthly quota is exhausted" };
    }
    remaining.checkleakedcc -= 1;
    await recordProviderCall("checkleakedcc");
    return lookupCheckLeakedCc(isrc, spotifyTrackId, checkLeakedCcKey);
  }

  if (preferredProvider === "beat_analytics") {
    if (!spotifyTrackId) {
      return { streams: null, provider: "beat_analytics", error: "Beat Analytics requires a Spotify track ID" };
    }
    if (!beatAnalyticsKey) {
      return { streams: null, provider: "beat_analytics", error: "Beat Analytics is not configured" };
    }
    if (remaining.beat_analytics <= 0) {
      return { streams: null, provider: "beat_analytics", error: "Beat Analytics daily quota is exhausted" };
    }
    remaining.beat_analytics -= 1;
    await recordProviderCall("beat_analytics");
    return lookupBeatAnalytics(spotifyTrackId, beatAnalyticsKey);
  }

  if (!musicMetricsKey) {
    return { streams: null, provider: "music_metrics", error: "Music Metrics is not configured" };
  }
  if (remaining.music_metrics <= 0 && !allowMusicMetricsOverage) {
    return { streams: null, provider: "music_metrics", error: "Music Metrics free quota is exhausted" };
  }
  remaining.music_metrics -= 1;
  await recordProviderCall("music_metrics");
  return lookupMusicMetrics(isrc, musicMetricsKey);
}

async function loadQuotaState(): Promise<QuotaState> {
  const date = todayKey();
  const used: Record<StreamLookupProvider, number> = {
    music_analytics: 0,
    checkleakedcc: 0,
    beat_analytics: 0,
    music_metrics: 0,
  };
  let configured = true;

  try {
    const svc = supabaseService();
    const { data, error } = await svc
      .from("stream_lookup_usage")
      .select("usage_date,provider,calls")
      .gte("usage_date", monthStartKey(date))
      .lte("usage_date", date);

    if (error) throw error;

    for (const row of (data ?? []) as Array<{ usage_date?: string; provider?: string; calls?: number }>) {
      if (row.provider === "checkleakedcc" || row.provider === "music_analytics") {
        used[row.provider] += Number(row.calls ?? 0);
      } else if (
        (row.provider === "beat_analytics" || row.provider === "music_metrics") &&
        row.usage_date === date
      ) {
        used[row.provider] = Number(row.calls ?? 0);
      }
    }
  } catch (e) {
    configured = !isSchemaMissing(e);
    const fallback = memoryUsage.__spotibaseStreamLookupUsage?.[date] ?? {};
    used.music_analytics = Number(fallback.music_analytics ?? 0);
    used.checkleakedcc = Number(fallback.checkleakedcc ?? 0);
    used.beat_analytics = Number(fallback.beat_analytics ?? 0);
    used.music_metrics = Number(fallback.music_metrics ?? 0);
  }

  return {
    date,
    configured,
    providers: {
      music_analytics: quotaForProvider("music_analytics", used.music_analytics),
      checkleakedcc: quotaForProvider("checkleakedcc", used.checkleakedcc),
      beat_analytics: quotaForProvider("beat_analytics", used.beat_analytics),
      music_metrics: quotaForProvider("music_metrics", used.music_metrics),
    },
  };
}

async function recordProviderCall(provider: StreamLookupProvider) {
  const date = todayKey();
  try {
    const svc = supabaseService();
    const quota = await loadQuotaState();
    const nextCalls = quota.providers[provider].used + 1;
    const { error } = await svc.from("stream_lookup_usage").upsert(
      [
        {
          usage_date: date,
          provider,
          calls: nextCalls,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: "usage_date,provider" },
    );
    if (error) throw error;
  } catch {
    memoryUsage.__spotibaseStreamLookupUsage ??= {};
    memoryUsage.__spotibaseStreamLookupUsage[date] ??= {};
    memoryUsage.__spotibaseStreamLookupUsage[date][provider] =
      Number(memoryUsage.__spotibaseStreamLookupUsage[date][provider] ?? 0) + 1;
  }
}

function quotaForProvider(provider: StreamLookupProvider, used: number): ProviderQuota {
  const cap = STREAM_LOOKUP_PROVIDER_CAPS[provider];
  return {
    provider,
    providerLabel: STREAM_LOOKUP_PROVIDER_LABELS[provider],
    window: STREAM_LOOKUP_PROVIDER_WINDOWS[provider],
    cap,
    used,
    remaining: Math.max(0, cap - used),
    overageCalls: provider === "music_metrics" ? Math.max(0, used - cap) : 0,
    overageAllowed: provider === "music_metrics",
    overageUnitCostUsd: provider === "music_metrics" ? 0.5 : null,
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartKey(date: string) {
  return `${date.slice(0, 7)}-01`;
}

async function lookupCheckLeakedCc(
  isrc: string,
  spotifyTrackId: string,
  apiKey: string,
): Promise<ProviderLookup> {
  const url = new URL(CHECKLEAKEDCC_ENDPOINT);
  url.searchParams.set("spotify_track_id", spotifyTrackId);
  url.searchParams.set("isrc", isrc);
  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-host": CHECKLEAKEDCC_RAPIDAPI_HOST,
      "x-rapidapi-key": apiKey,
      "Content-Type": "application/json",
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
    provider: "checkleakedcc",
    error: res.ok ? "No stream count from CheckLeakedCC" : "CheckLeakedCC request failed",
  };
}

async function lookupMusicAnalytics(
  spotifyTrackId: string,
  apiKey: string,
): Promise<ProviderLookup> {
  const url = new URL(`${MUSIC_ANALYTICS_ENDPOINT}/${encodeURIComponent(spotifyTrackId)}/streams/current`);
  const res = await fetch(url.toString(), {
    headers: {
      "x-rapidapi-host": MUSIC_ANALYTICS_RAPIDAPI_HOST,
      "x-rapidapi-key": apiKey,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const streams = Number(
    payload.streams ??
      payload.streamCount ??
      payload.current_stream_count ??
      payload.currentStreamCount,
  );
  return {
    streams: res.ok && Number.isFinite(streams) ? streams : null,
    provider: "music_analytics",
    error: res.ok ? "No stream count from MusicAnalytics" : "MusicAnalytics request failed",
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
