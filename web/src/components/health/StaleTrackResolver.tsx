"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchApiJson } from "@/lib/api";
import { TrackListItem } from "@/components/health/TrackListItem";
import type { PrevNonzeroTrack, StaleTrack, TrackBase } from "@/lib/health/types";

type LookupResult = {
  isrc: string;
  streams: number | null;
  status: "ok" | "failed" | "suspicious";
  provider?: "music_analytics" | "checkleakedcc" | "beat_analytics" | "music_metrics";
  providerLabel?: string;
  error?: string;
};

type ProviderQuota = {
  providerLabel: string;
  window: "daily" | "monthly";
  cap: number;
  used: number;
  remaining: number;
  overageCalls: number;
  overageAllowed: boolean;
  overageUnitCostUsd: number | null;
};

type QuotaPayload = {
  quota: {
    date: string;
    configured: boolean;
    providers: {
      music_analytics: ProviderQuota;
      checkleakedcc: ProviderQuota;
      beat_analytics: ProviderQuota;
      music_metrics: ProviderQuota;
    };
  };
  results?: LookupResult[];
};

type Phase = "idle" | "fetching" | "review" | "applying" | "done";
type ResolverMode = "stale" | "missing_snapshot" | "prev_nonzero";
type LookupTrack = TrackBase & Partial<StaleTrack> & Partial<PrevNonzeroTrack>;
type TestableProvider = "beat_analytics" | "music_metrics" | "music_analytics" | "checkleakedcc";

const PROVIDER_URLS = {
  music_analytics: "https://rapidapi.com/MusicAnalyticsApi/api/spotify-stream-count",
  checkleakedcc: "https://rapidapi.com/airaudoeduardo/api/spotify81",
  beat_analytics: "https://rapidapi.com/beat-analytics-beat-analytics-default/api/spotify-statistics-and-stream-count",
  music_metrics: "https://rapidapi.com/music-metrics-music-metrics-default/api/spotify-track-streams-playback-count1",
} as const;

const MODE_COPY: Record<
  ResolverMode,
  {
    title: string;
    fetchLabel: string;
    applyLabel: string;
    notePrefix: string;
    baselineLabel: string;
  }
> = {
  stale: {
    title: "Tracks with stale streams",
    fetchLabel: "Fetch Stream Counts",
    applyLabel: "Apply Selected",
    notePrefix: "stale-fix",
    baselineLabel: "total",
  },
  missing_snapshot: {
    title: "Missing catalog stream snapshots",
    fetchLabel: "Resolve Missing Snapshots",
    applyLabel: "Apply Snapshot Overrides",
    notePrefix: "missing-snapshot-fix",
    baselineLabel: "prev",
  },
  prev_nonzero: {
    title: "Missing stream totals with prior non-zero",
    fetchLabel: "Resolve Missing Totals",
    applyLabel: "Apply Prev-Nonzero Overrides",
    notePrefix: "prev-nonzero-fix",
    baselineLabel: "prev",
  },
};

export function StaleTrackResolver({
  tracks,
  thumbOverrides,
  runDate,
  mode = "stale",
}: {
  tracks: LookupTrack[];
  thumbOverrides: Record<string, string | null>;
  runDate: string;
  mode?: ResolverMode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [fetchProgress, setFetchProgress] = useState(0);
  const [fetchStartedAt, setFetchStartedAt] = useState<number | null>(null);
  const [results, setResults] = useState<Map<string, LookupResult>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState("");
  const [appliedCount, setAppliedCount] = useState(0);
  const [quota, setQuota] = useState<QuotaPayload["quota"] | null>(null);
  const [quotaLoaded, setQuotaLoaded] = useState(false);
  const [quotaError, setQuotaError] = useState("");
  const [allowMusicMetricsOverage, setAllowMusicMetricsOverage] = useState(false);
  const [showOverageConfirm, setShowOverageConfirm] = useState(false);
  const [testProvider, setTestProvider] = useState<TestableProvider>("music_analytics");
  const [testingProvider, setTestingProvider] = useState<TestableProvider | null>(null);
  const copy = MODE_COPY[mode];

  const refreshLookupState = useCallback(async () => {
    try {
      const data = await fetchApiJson<QuotaPayload>(
        `/api/rapidapi-stale-lookup?date=${encodeURIComponent(runDate)}&context=${encodeURIComponent(mode)}`,
      );
      setQuota(data.quota);
      setQuotaError("");
      if (Array.isArray(data.results) && data.results.length > 0) {
        const map = new Map<string, LookupResult>();
        const autoSelect = new Set<string>();
        for (const r of data.results) {
          const isrc = r.isrc.trim().toUpperCase();
          map.set(isrc, { ...r, isrc });
          if (r.status === "ok" && r.streams != null) autoSelect.add(isrc);
        }
        setResults(map);
        setSelected(autoSelect);
        setPhase("review");
      }
    } catch (e) {
      setQuota(null);
      setQuotaError(e instanceof Error ? e.message : "Could not load provider usage");
    } finally {
      setQuotaLoaded(true);
    }
  }, [runDate]);

  useEffect(() => {
    void refreshLookupState();
  }, [refreshLookupState]);

  const unresolvedTracks = useMemo(
    () =>
      tracks.filter((t) => {
        const isrc = t.isrc.trim().toUpperCase();
        const result = results.get(isrc);
        return !result || result.status === "failed";
      }),
    [results, tracks],
  );
  const sourceTracks = phase === "review" || phase === "done" ? unresolvedTracks : tracks;
  const remainingLookups = quota
    ? quota.providers.beat_analytics.remaining +
      quota.providers.music_metrics.remaining +
      quota.providers.music_analytics.remaining +
      quota.providers.checkleakedcc.remaining +
      (allowMusicMetricsOverage ? sourceTracks.length : 0)
    : 1120;
  const lookupLimit = Math.max(0, Math.min(sourceTracks.length, remainingLookups));
  const lookupTracks = useMemo(() => sourceTracks.slice(0, lookupLimit), [sourceTracks, lookupLimit]);
  const overageNeeded = quota != null && sourceTracks.length > (
    quota.providers.beat_analytics.remaining +
      quota.providers.music_metrics.remaining +
      quota.providers.music_analytics.remaining +
      quota.providers.checkleakedcc.remaining
  );
  const estimatedOverageCalls = quota
    ? Math.max(
        0,
        Math.min(sourceTracks.length, lookupLimit) -
          quota.providers.beat_analytics.remaining -
          quota.providers.music_metrics.remaining -
          quota.providers.music_analytics.remaining -
          quota.providers.checkleakedcc.remaining,
      )
    : 0;
  const estimatedOverageCostUsd = estimatedOverageCalls * 0.5;

  useEffect(() => {
    if (phase === "fetching" && fetchStartedAt == null) {
      setFetchStartedAt(Date.now());
    }
  }, [fetchStartedAt, phase]);

  useEffect(() => {
    if (phase !== "fetching" || fetchStartedAt == null || lookupTracks.length === 0) {
      return;
    }

    const estimatedLookupMs = Math.max(lookupTracks.length * 8000, 10000);
    const timer = window.setInterval(() => {
      const elapsedMs = Date.now() - fetchStartedAt;
      const estimatedProgress = (elapsedMs / estimatedLookupMs) * lookupTracks.length;
      setFetchProgress((current) =>
        Math.min(
          lookupTracks.length * 0.95,
          Math.max(current, estimatedProgress),
        ),
      );
    }, 1000);

    return () => window.clearInterval(timer);
  }, [fetchStartedAt, lookupTracks.length, phase]);

  const handleFetch = useCallback(async () => {
    if (lookupTracks.length === 0) {
      setApplyError("Daily stream lookup quota is exhausted.");
      return;
    }
    if (estimatedOverageCalls > 0 && !showOverageConfirm) {
      setShowOverageConfirm(true);
      return;
    }
    setPhase("fetching");
    setFetchProgress(0);
    setFetchStartedAt(Date.now());
    setShowOverageConfirm(false);
    if (phase === "idle") setResults(new Map());

    const isrcs = lookupTracks.map((t) => t.isrc.trim().toUpperCase());
    const staleStreams: Record<string, number> = {};
    const spotifyTrackIds: Record<string, string> = {};
    for (const t of lookupTracks) {
      const isrc = t.isrc.trim().toUpperCase();
      const baseline = getBaseline(t, mode);
      if (
        typeof baseline === "number" &&
        Number.isFinite(baseline)
      ) {
        staleStreams[isrc] = baseline;
      }
      const spotifyTrackId = t.spotify_track_id?.trim();
      if (spotifyTrackId) spotifyTrackIds[isrc] = spotifyTrackId;
    }

    try {
      const data = await fetchApiJson<{ results: LookupResult[]; quota?: QuotaPayload["quota"] }>("/api/rapidapi-stale-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isrcs,
          staleStreams,
          spotifyTrackIds,
          allowMusicMetricsOverage,
          context: mode,
        }),
      });
      const map = new Map(results);
      const autoSelect = new Set<string>();

      for (const r of data.results) {
        map.set(r.isrc, r);
        if (r.status === "ok" && r.streams != null) {
          autoSelect.add(r.isrc);
        }
      }

      setResults(map);
      setSelected(autoSelect);
      setFetchProgress(isrcs.length);
      setFetchStartedAt(null);
      if (data.quota) setQuota(data.quota);
      else void refreshLookupState();
      setPhase("review");
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Fetch failed");
      setFetchStartedAt(null);
      setPhase("idle");
    }
  }, [allowMusicMetricsOverage, estimatedOverageCalls, lookupTracks, mode, phase, refreshLookupState, results, showOverageConfirm]);

  const handleProviderTest = useCallback(async () => {
    const track = tracks.find((t) => t.spotify_track_id?.trim());
    if (!track) {
      setApplyError("No track with a Spotify ID is available for a provider test.");
      return;
    }
    setTestingProvider(testProvider);
    setApplyError("");
    const isrc = track.isrc.trim().toUpperCase();
    const baseline = getBaseline(track, mode);
    try {
      const data = await fetchApiJson<{ results: LookupResult[]; quota?: QuotaPayload["quota"] }>("/api/rapidapi-stale-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isrcs: [isrc],
          staleStreams: typeof baseline === "number" ? { [isrc]: baseline } : {},
          spotifyTrackIds: { [isrc]: track.spotify_track_id?.trim() },
          preferredProvider: testProvider,
          allowMusicMetricsOverage:
            testProvider === "music_metrics" && allowMusicMetricsOverage,
          context: mode,
        }),
      });
      const result = data.results[0];
      if (result) {
        const next = new Map(results);
        next.set(isrc, result);
        setResults(next);
        if (result.status === "ok" && result.streams != null) {
          setSelected(new Set([isrc]));
          setPhase("review");
        }
      }
      if (data.quota) setQuota(data.quota);
      await refreshLookupState();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Provider test failed");
    } finally {
      setTestingProvider(null);
    }
  }, [allowMusicMetricsOverage, mode, refreshLookupState, results, testProvider, tracks]);

  const toggleSelect = useCallback((isrc: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(isrc)) next.delete(isrc);
      else next.add(isrc);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const selectable = new Set<string>();
    for (const t of tracks) {
      const isrc = t.isrc.trim().toUpperCase();
      const r = results.get(isrc);
      if (r?.streams != null) selectable.add(isrc);
    }
    setSelected(selectable);
  }, [results, tracks]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const handleApply = useCallback(async () => {
    if (selected.size === 0) return;
    setPhase("applying");
    setApplyError("");

    const overrides = Array.from(selected)
      .map((isrc) => {
        const r = results.get(isrc);
        if (!r || r.streams == null) return null;
        return {
          isrc,
          streams_cumulative: r.streams,
          provider: r.provider,
          providerLabel: r.providerLabel,
        };
      })
      .filter(Boolean) as {
        isrc: string;
        streams_cumulative: number;
        provider?: "music_analytics" | "checkleakedcc" | "beat_analytics" | "music_metrics";
        providerLabel?: string;
      }[];

    try {
      await fetchApiJson("/api/health-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_override",
          date: runDate,
          notePrefix: copy.notePrefix,
          overrides,
        }),
      });

      setAppliedCount(overrides.length);
      setPhase("done");
      setTimeout(() => router.refresh(), 1200);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Apply failed");
      setPhase("review");
    }
  }, [copy.notePrefix, selected, results, runDate, router]);

  const selectableCount = tracks.filter((t) => {
    const r = results.get(t.isrc.trim().toUpperCase());
    return r?.streams != null;
  }).length;
  const spotifyIdEligibleCount = lookupTracks.filter((t) => t.spotify_track_id?.trim()).length;
  const lookupTooltip =
    spotifyIdEligibleCount > 0
      ? "Uses Beat Analytics first (50 free/day), then Music Metrics (20 free/day), then MusicAnalytics (50 free/month), then CheckLeakedCC (1000 free/month). Paid Music Metrics is only used if you allow overage."
      : "Uses Music Metrics. Beat Analytics, MusicAnalytics, and CheckLeakedCC need Spotify track IDs, and none are available for this track set.";
  const lookupButtonLabel =
    lookupLimit < sourceTracks.length
      ? `${lookupLimit.toLocaleString()} of ${sourceTracks.length.toLocaleString()} lookup${sourceTracks.length === 1 ? "" : "s"}`
      : `${sourceTracks.length.toLocaleString()} lookup${sourceTracks.length === 1 ? "" : "s"}`;
  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs font-medium opacity-70">
          {copy.title} ({tracks.length}):
        </div>
        <div className="basis-full text-[10px] opacity-60">
          {quota ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <QuotaToken
                href={PROVIDER_URLS.beat_analytics}
                quota={quota.providers.beat_analytics}
                suffix="day"
                tone="daily"
              />
              <QuotaToken
                href={PROVIDER_URLS.music_metrics}
                quota={quota.providers.music_metrics}
                suffix="free"
                tone="daily"
              />
              <QuotaToken
                href={PROVIDER_URLS.music_analytics}
                quota={quota.providers.music_analytics}
                suffix="mo"
                tone="monthly"
              />
              <QuotaToken
                href={PROVIDER_URLS.checkleakedcc}
                quota={quota.providers.checkleakedcc}
                suffix="mo"
                tone="monthly"
              />
              {quota.providers.music_metrics.overageCalls > 0 ? (
                <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                  Music Metrics{" "}
                  <span className="font-medium tabular-nums">
                    {quota.providers.music_metrics.overageCalls}
                  </span>{" "}
                  paid
                </span>
              ) : null}
            </div>
          ) : (
            quotaLoaded
              ? `Quota unavailable: ${quotaError || "could not load provider usage"}`
              : "Quota: checking provider usage..."
          )}
          {quota && !quota.configured ? " (temporary local tracking until the quota migration is applied)" : ""}
        </div>
        {(phase === "idle" || phase === "review" || phase === "done") && overageNeeded ? (
          <label className="basis-full inline-flex items-center gap-2 text-[10px] opacity-80">
            <input
              type="checkbox"
              checked={allowMusicMetricsOverage}
              onChange={(e) => setAllowMusicMetricsOverage(e.target.checked)}
              className="rounded accent-[var(--sb-accent)]"
            />
            <span>
              Allow Music Metrics paid overage after 20 free calls ($0.50/call)
              {allowMusicMetricsOverage && estimatedOverageCalls > 0
                ? ` · estimated ${estimatedOverageCalls} paid call${estimatedOverageCalls === 1 ? "" : "s"}`
                : ""}
            </span>
          </label>
        ) : null}

        {showOverageConfirm && estimatedOverageCalls > 0 ? (
          <div className="basis-full rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
            <div className="font-medium">Confirm paid Music Metrics overage</div>
            <div className="mt-1 opacity-80">
              This lookup may use {estimatedOverageCalls.toLocaleString()} paid call{estimatedOverageCalls === 1 ? "" : "s"} at $0.50 each, estimated ${estimatedOverageCostUsd.toFixed(2)}.
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={handleFetch}
                className="rounded-md bg-amber-500 px-2.5 py-1 font-medium text-black hover:opacity-90 sb-ring"
              >
                Run paid lookup
              </button>
              <button
                type="button"
                onClick={() => setShowOverageConfirm(false)}
                className="rounded-md bg-white/10 px-2.5 py-1 font-medium hover:bg-white/15 sb-ring"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {phase === "idle" && (
          <div className="flex items-center gap-2">
            {applyError && (
              <span className="text-[10px] text-red-400">{applyError}</span>
            )}
            <button
              type="button"
              onClick={handleFetch}
              title={lookupTooltip}
              aria-label={`Fetch stream counts. ${lookupTooltip}`}
              disabled={lookupLimit === 0}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-all
                bg-[var(--sb-accent)]/15 text-[var(--sb-positive)] hover:bg-[var(--sb-accent)]/25
                disabled:opacity-40 disabled:cursor-not-allowed sb-ring"
            >
              <SpotifyIcon />
              {copy.fetchLabel}
              <span className="opacity-60 font-normal">
                ({lookupButtonLabel})
              </span>
            </button>
            {spotifyIdEligibleCount > 0 ? (
              <div className="inline-flex items-center gap-1">
                <label className="relative inline-flex items-center">
                  <select
                    value={testProvider}
                    onChange={(e) => setTestProvider(e.target.value as TestableProvider)}
                    className="h-7 appearance-none rounded-lg border border-white/10 bg-white/[0.06] py-1 pl-2.5 pr-7 text-[10px] font-medium text-[var(--sb-text)] shadow-sm outline-none transition hover:bg-white/[0.09] focus:border-[var(--sb-accent)]/40 focus:bg-white/[0.1] sb-ring"
                    aria-label="Provider to test"
                  >
                    <option value="beat_analytics">Beat Analytics</option>
                    <option value="music_metrics">Music Metrics</option>
                    <option value="music_analytics">MusicAnalytics</option>
                    <option value="checkleakedcc">CheckLeakedCC</option>
                  </select>
                  <ChevronDownIcon />
                </label>
                <button
                  type="button"
                  onClick={handleProviderTest}
                  disabled={
                    testingProvider != null ||
                    quota?.providers[testProvider].remaining === 0
                  }
                  title={`Run exactly one lookup through ${quota?.providers[testProvider].providerLabel ?? testProvider} only, for smoke testing.`}
                  className="h-7 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[10px] font-medium text-[var(--sb-text)] transition hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-40 sb-ring"
                >
                  {testingProvider ? "Testing..." : "Test provider"}
                </button>
              </div>
            ) : null}
          </div>
        )}

        {phase === "fetching" && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--sb-accent)] transition-all duration-500"
                style={{
                  width: `${lookupTracks.length > 0 ? (fetchProgress / lookupTracks.length) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[10px] opacity-60 animate-pulse">
              Checking {lookupTracks.length.toLocaleString()} track{lookupTracks.length === 1 ? "" : "s"}...
            </span>
          </div>
        )}

        {phase === "review" && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={
                selected.size === selectableCount ? deselectAll : selectAll
              }
              className="text-[10px] px-2 py-0.5 rounded sb-ring bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 opacity-70 hover:opacity-100 transition"
            >
              {selected.size === selectableCount
                ? "Deselect All"
                : "Select All"}
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-all
                bg-green-500/20 text-green-700 dark:text-green-400 hover:bg-green-500/30
                disabled:opacity-30 disabled:cursor-not-allowed sb-ring"
            >
              {copy.applyLabel} ({selected.size})
            </button>
            {applyError && (
              <span className="text-[10px] text-red-400">{applyError}</span>
            )}
          </div>
        )}

        {phase === "applying" && (
          <span className="text-[10px] opacity-60 animate-pulse">
            Applying overrides...
          </span>
        )}

        {phase === "done" && unresolvedTracks.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-green-700 dark:text-green-400 font-medium">
              {appliedCount} override{appliedCount !== 1 ? "s" : ""} applied
            </span>
            <button
              type="button"
              onClick={handleFetch}
              disabled={lookupLimit === 0}
              title={lookupTooltip}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-all
                bg-[var(--sb-accent)]/15 text-[var(--sb-positive)] hover:bg-[var(--sb-accent)]/25
                disabled:opacity-40 disabled:cursor-not-allowed sb-ring"
            >
              <SpotifyIcon />
              Fetch Remaining
              <span className="opacity-60 font-normal">
                ({lookupButtonLabel})
              </span>
            </button>
          </div>
        )}

        {phase === "done" && unresolvedTracks.length === 0 && (
          <span className="text-[11px] text-green-700 dark:text-green-400 font-medium">
            {appliedCount} override{appliedCount !== 1 ? "s" : ""} applied
          </span>
        )}
      </div>

      {/* ── Track list ── */}
      <div className="space-y-2">
        {tracks.map((t) => {
          const isrc = t.isrc.trim().toUpperCase();
          const result = results.get(isrc);
          const cumulative = getBaseline(t, mode);

          return (
            <TrackListItem
              key={isrc}
              track={t}
              thumbOverrides={thumbOverrides}
              dense
              className="rounded-md px-2 py-1.5"
              style={{ backgroundColor: "var(--sb-surface)" }}
              inlineExtra={
                <StaleStreamInfo
                  stale={cumulative}
                  baselineLabel={copy.baselineLabel}
                  avg7d={t.avg_daily_7d ?? null}
                  result={result ?? null}
                />
              }
              actions={
                phase === "review" && result && result.streams != null ? (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selected.has(isrc)}
                      onChange={() => toggleSelect(isrc)}
                      className="rounded accent-[var(--sb-accent)]"
                    />
                    <span className="text-[10px] opacity-60">
                      Apply override
                    </span>
                  </label>
                ) : undefined
              }
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Inline stream info shown per track ── */

function StaleStreamInfo({
  stale,
  baselineLabel,
  avg7d,
  result,
}: {
  stale: number | null;
  baselineLabel: string;
  avg7d: number | null;
  result: LookupResult | null;
}) {
  return (
    <>
      {/* Stale cumulative */}
      {stale !== null && (
        <span className="opacity-60">
          · {baselineLabel}:{" "}
          <span
            className={[
              "font-mono",
              result && result.status === "ok" ? "line-through opacity-50" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {stale.toLocaleString()}
          </span>
        </span>
      )}

      {/* 7d avg (only when no lookup result yet) */}
      {avg7d !== null && Number.isFinite(avg7d) && !result && (
        <span className="opacity-60">
          · avg/day:{" "}
          <span className="font-mono">
            {avg7d.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          </span>
        </span>
      )}

      {/* Stream provider result */}
      {result && result.status === "ok" && result.streams != null && (
        <>
          <span className="text-green-700 dark:text-green-400 font-medium">
            → {result.providerLabel ?? "Provider"}:{" "}
            <span className="font-mono">
              {result.streams.toLocaleString()}
            </span>
          </span>
          {stale != null ? (
            <span className="inline-flex flex-wrap items-center gap-1 text-[10px] font-mono">
              <span className="opacity-50">
                from {stale.toLocaleString()}
              </span>
              <span className="text-green-700 dark:text-green-400">
                to {result.streams.toLocaleString()}
              </span>
              <span className="text-green-700/70 dark:text-green-500/70">
                by +{(result.streams - stale).toLocaleString()}
              </span>
            </span>
          ) : (
            <span className="font-mono text-green-700 dark:text-green-400">
              to {result.streams.toLocaleString()}
            </span>
          )}
        </>
      )}

      {result && result.status === "suspicious" && result.streams != null && (
        <>
          <span className="text-amber-400 font-medium">
            → {result.providerLabel ?? "Provider"}:{" "}
            <span className="font-mono">
              {result.streams.toLocaleString()}
            </span>
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-400/80 font-medium rounded-full bg-amber-500/10 px-1.5 py-0.5">
            ⚠ Below stale count
          </span>
        </>
      )}

      {result && result.status === "failed" && (
        <span className="text-[10px] text-red-400/80 font-medium">
          · lookup failed
        </span>
      )}
    </>
  );
}

/* ── Small Spotify icon ── */

function SpotifyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 flex-shrink-0"
      fill="currentColor"
    >
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="pointer-events-none absolute right-2 h-3 w-3 opacity-55"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function ProviderLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium underline decoration-white/20 underline-offset-2 hover:opacity-80"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}

function QuotaToken({
  href,
  quota,
  suffix,
  tone,
}: {
  href: string;
  quota: ProviderQuota;
  suffix: string;
  tone: "daily" | "monthly";
}) {
  const toneClass =
    tone === "daily"
      ? "border-lime-500/15 bg-lime-500/[0.06]"
      : "border-sky-500/15 bg-sky-500/[0.06]";

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${toneClass}`}>
      <ProviderLink href={href} label={quota.providerLabel} />
      <span className="font-medium tabular-nums text-[var(--sb-text)]">
        {quota.used}/{quota.cap}
      </span>
      <span className="opacity-55">{suffix}</span>
    </span>
  );
}

function getBaseline(track: LookupTrack, mode: ResolverMode): number | null {
  const value =
    mode === "prev_nonzero" || mode === "missing_snapshot"
      ? track.prev_streams_cumulative
      : track.streams_cumulative;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
