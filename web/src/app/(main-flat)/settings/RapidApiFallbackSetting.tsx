"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type FallbackState = {
  count: number;
  latestDate: string | null;
  prevDate: string | null;
  loading: boolean;
  error: string | null;
};

type RepairedTrack = {
  isrc: string;
  prev_streams_cumulative: number;
  new_streams_cumulative: number;
};

type RunResult = {
  repaired: number;
  attempted: number;
  latestDate?: string;
  message?: string;
  error?: string;
  repairedTracks?: RepairedTrack[];
};

export function RapidApiFallbackSetting() {
  const [state, setState] = useState<FallbackState>({
    count: 0,
    latestDate: null,
    prevDate: null,
    loading: true,
    error: null,
  });
  const [numTracks, setNumTracks] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  const fetchCount = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("/api/rapidapi-fallback", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState((s) => ({
          ...s,
          loading: false,
          count: 0,
          latestDate: null,
          prevDate: null,
          error: (data as any)?.error ?? "Failed to load",
        }));
        return;
      }
      setState({
        count: Number((data as any).count ?? 0) || 0,
        latestDate: (data as any).latestDate ?? null,
        prevDate: (data as any).prevDate ?? null,
        loading: false,
        error: null,
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load",
      }));
    }
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  async function runFallback() {
    const n = Math.max(1, Math.min(state.count, numTracks));
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/rapidapi-fallback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numTracks: n }),
      });
      const data = await res.json().catch(() => ({})) as RunResult & { error?: string };
      if (!res.ok) {
        setResult({ repaired: 0, attempted: 0, error: data.error ?? "Request failed" });
        setRunning(false);
        return;
      }
      setResult({
        repaired: data.repaired ?? 0,
        attempted: data.attempted ?? 0,
        latestDate: data.latestDate,
        message: data.message,
        repairedTracks: data.repairedTracks ?? [],
      });
      setRunning(false);
      await fetchCount();
    } catch (e) {
      setResult({
        repaired: 0,
        attempted: 0,
        error: e instanceof Error ? e.message : "Request failed",
      });
      setRunning(false);
    }
  }

  const maxAllowed = Math.min(state.count, 50);
  const valueClamped = Math.max(1, Math.min(numTracks, maxAllowed || 1));

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <div className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">RapidAPI stream fallback</h3>
          <p className="mt-1 text-xs opacity-70">
            Backfill total stream counts for tracks that SpotOnTrack skipped on the latest run,
            using the RapidAPI Spotify Track Streams endpoint. Run this manually when you see
            missing streams; it does not run during the daily ingestion.
          </p>
        </div>

        {state.loading ? (
          <p className="text-xs opacity-60">Loading…</p>
        ) : state.error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">
                <strong>{state.count}</strong> track{state.count !== 1 ? "s" : ""} require
                fallback
                {state.latestDate ? (
                  <span className="opacity-70"> (for run date {state.latestDate})</span>
                ) : null}
              </span>
            </div>

            {state.count > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium opacity-70">Number of tracks to fix:</label>
                <input
                  type="number"
                  min={1}
                  max={maxAllowed || 50}
                  value={valueClamped}
                  onChange={(e) => setNumTracks(Number(e.target.value) || 1)}
                  className="sb-ring h-9 w-24 rounded-lg bg-white/60 px-2 text-sm dark:bg-white/10"
                  disabled={running}
                />
                <span className="text-xs opacity-60">(max {maxAllowed})</span>
                <button
                  type="button"
                  onClick={runFallback}
                  disabled={running}
                  className="sb-ring inline-flex h-9 items-center justify-center rounded-lg bg-black px-3 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
                >
                  {running ? "Running…" : `Run fallback for ${valueClamped} track${valueClamped !== 1 ? "s" : ""}`}
                </button>
              </div>
            )}

            {state.count === 0 && !state.loading && (
              <p className="text-xs opacity-60">No tracks currently need fallback.</p>
            )}
          </>
        )}

        {result && (
          <div className="space-y-2 text-xs">
            {result.error ? (
              <p className="text-red-600 dark:text-red-400">{result.error}</p>
            ) : (
              <>
                <p className="text-green-600 dark:text-green-400">
                  Repaired <strong>{result.repaired}</strong> of {result.attempted} attempted
                  {result.latestDate ? ` for ${result.latestDate}` : ""}.
                  {result.message ? ` ${result.message}` : ""}
                </p>
                {result.repairedTracks && result.repairedTracks.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-white/20">
                          <th className="text-left py-1.5 font-medium">Track (ISRC)</th>
                          <th className="text-right py-1.5 font-medium">Yesterday&apos;s streams</th>
                          <th className="text-right py-1.5 font-medium">New streams</th>
                          <th className="text-right py-1.5 font-medium">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.repairedTracks.map((t) => (
                          <tr key={t.isrc} className="border-b border-white/10">
                            <td className="py-1.5">
                              <Link
                                href={`/tracks/${t.isrc}`}
                                className="font-mono text-[10px] sb-positive underline hover:opacity-80"
                              >
                                {t.isrc}
                              </Link>
                            </td>
                            <td className="text-right font-mono tabular-nums">
                              {t.prev_streams_cumulative.toLocaleString()}
                            </td>
                            <td className="text-right font-mono tabular-nums">
                              {t.new_streams_cumulative.toLocaleString()}
                            </td>
                            <td className="text-right font-mono tabular-nums">
                              +{(t.new_streams_cumulative - t.prev_streams_cumulative).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
