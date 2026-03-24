"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchApiJson } from "@/lib/api";
import { TrackListItem } from "@/components/health/TrackListItem";
import type { StaleTrack } from "@/lib/health/types";

type LookupResult = {
  isrc: string;
  streams: number | null;
  status: "ok" | "failed" | "suspicious";
  error?: string;
};

type Phase = "idle" | "fetching" | "review" | "applying" | "done";

export function StaleTrackResolver({
  tracks,
  thumbOverrides,
  runDate,
}: {
  tracks: StaleTrack[];
  thumbOverrides: Record<string, string | null>;
  runDate: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [fetchProgress, setFetchProgress] = useState(0);
  const [results, setResults] = useState<Map<string, LookupResult>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState("");
  const [appliedCount, setAppliedCount] = useState(0);

  const handleFetch = useCallback(async () => {
    setPhase("fetching");
    setFetchProgress(0);
    setResults(new Map());

    const isrcs = tracks.map((t) => t.isrc.trim().toUpperCase());
    const staleStreams: Record<string, number> = {};
    for (const t of tracks) {
      const isrc = t.isrc.trim().toUpperCase();
      if (
        typeof t.streams_cumulative === "number" &&
        Number.isFinite(t.streams_cumulative)
      ) {
        staleStreams[isrc] = t.streams_cumulative;
      }
    }

    try {
      const data = await fetchApiJson<{ results: LookupResult[] }>("/api/rapidapi-stale-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isrcs, staleStreams }),
      });
      const map = new Map<string, LookupResult>();
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
      setPhase("review");
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Fetch failed");
      setPhase("idle");
    }
  }, [tracks]);

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
    for (const [isrc, r] of results) {
      if (r.streams != null) selectable.add(isrc);
    }
    setSelected(selectable);
  }, [results]);

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
        return { isrc, streams_cumulative: r.streams };
      })
      .filter(Boolean) as { isrc: string; streams_cumulative: number }[];

    try {
      await fetchApiJson("/api/health-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "batch_override",
          date: runDate,
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
  }, [selected, results, runDate, router]);

  const selectableCount = Array.from(results.values()).filter(
    (r) => r.streams != null,
  ).length;

  return (
    <div className="space-y-3">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs font-medium opacity-70">
          Tracks with stale streams ({tracks.length}):
        </div>

        {phase === "idle" && (
          <div className="flex items-center gap-2">
            {applyError && (
              <span className="text-[10px] text-red-400">{applyError}</span>
            )}
            <button
              type="button"
              onClick={handleFetch}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-all
                bg-[var(--sb-accent)]/15 text-[var(--sb-positive)] hover:bg-[var(--sb-accent)]/25
                sb-ring"
            >
              <SpotifyIcon />
              Fetch Spotify Streams
              <span className="opacity-60 font-normal">
                ({tracks.length} API call{tracks.length !== 1 ? "s" : ""})
              </span>
            </button>
          </div>
        )}

        {phase === "fetching" && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--sb-accent)] transition-all duration-500"
                style={{
                  width: `${tracks.length > 0 ? (fetchProgress / tracks.length) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="text-[10px] opacity-60 animate-pulse">
              Fetching from Spotify...
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
              Apply Selected ({selected.size})
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

        {phase === "done" && (
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
          const cumulative =
            typeof t.streams_cumulative === "number" &&
            Number.isFinite(t.streams_cumulative)
              ? t.streams_cumulative
              : null;

          return (
            <TrackListItem
              key={isrc}
              track={t}
              thumbOverrides={thumbOverrides}
              inlineExtra={
                <StaleStreamInfo
                  stale={cumulative}
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
  avg7d,
  result,
}: {
  stale: number | null;
  avg7d: number | null;
  result: LookupResult | null;
}) {
  return (
    <>
      {/* Stale cumulative */}
      {stale !== null && (
        <span className="opacity-60">
          · total:{" "}
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

      {/* Spotify result */}
      {result && result.status === "ok" && result.streams != null && (
        <>
          <span className="text-green-700 dark:text-green-400 font-medium">
            → Spotify:{" "}
            <span className="font-mono">
              {result.streams.toLocaleString()}
            </span>
          </span>
          {stale != null && result.streams > stale && (
            <span className="text-green-700/70 dark:text-green-500/70 text-[10px] font-mono">
              (+{(result.streams - stale).toLocaleString()})
            </span>
          )}
        </>
      )}

      {result && result.status === "suspicious" && result.streams != null && (
        <>
          <span className="text-amber-400 font-medium">
            → Spotify:{" "}
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
