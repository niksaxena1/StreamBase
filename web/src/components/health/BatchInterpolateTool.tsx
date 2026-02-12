"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  date: string;
  track_count: number;
  prev_date: string;
  prev_count: number;
  next_date: string;
  next_count: number;
  missing_estimate: number;
  stale_count?: number | null;
};

type Result = {
  overrides_created: number;
  missing_count: number;
  stale_count: number;
  date: string;
};

export function BatchInterpolateTool() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [includeStale, setIncludeStale] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/batch-interpolate");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load");
      setCandidates((data as any)?.candidates ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCandidates();
  }, [fetchCandidates]);

  async function runInterpolation(date: string) {
    setRunning(date);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/batch-interpolate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, include_stale: includeStale }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "Failed");
      setResult(data as Result);
      // Refresh candidates and page
      await fetchCandidates();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5">
      <h3 className="text-sm font-semibold mb-1">Batch Interpolation</h3>
      <p className="text-xs opacity-70 mb-3">
        Detect dates with missing or stale track data and fill gaps by
        interpolating between the day before and the day after.
      </p>

      {loading && (
        <div className="text-xs opacity-60">Scanning for gaps...</div>
      )}

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 mb-2">
          {error}
        </div>
      )}

      {!loading && candidates.length === 0 && !error && (
        <div className="text-xs opacity-60">
          No dates with missing data detected in the last 14 days.
        </div>
      )}

      {!loading && candidates.length > 0 && (
        <>
          <div className="mb-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeStale}
                onChange={(e) => setIncludeStale(e.target.checked)}
                className="rounded"
              />
              Include stale tracks (same streams as prior day)
            </label>
          </div>

          <div className="space-y-2">
            {candidates.map((c) => (
              <div
                key={c.date}
                className="flex items-center gap-3 text-xs sb-ring rounded-xl bg-white/50 dark:bg-white/5 p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium font-mono">{c.date}</div>
                  <div className="opacity-70 mt-0.5">
                    {c.track_count.toLocaleString()} tracks (neighbors:{" "}
                    {c.prev_count.toLocaleString()} / {c.next_count.toLocaleString()})
                    {" "}&middot; ~{c.missing_estimate.toLocaleString()} missing
                    {c.stale_count != null && c.stale_count > 0 && (
                      <> &middot; ~{c.stale_count.toLocaleString()} stale</>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => runInterpolation(c.date)}
                  disabled={running !== null}
                  className={[
                    "sb-ring inline-flex h-8 items-center justify-center rounded-lg px-3 text-xs font-medium transition shrink-0",
                    "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
                    running !== null ? "opacity-40 cursor-not-allowed" : "",
                  ].join(" ")}
                >
                  {running === c.date ? "Running..." : "Interpolate"}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {result && (
        <div className="mt-3 text-xs sb-ring rounded-xl bg-green-500/10 p-3">
          <span className="font-medium text-green-700 dark:text-green-400">
            Done:
          </span>{" "}
          {result.overrides_created.toLocaleString()} overrides created for{" "}
          {result.date} ({result.missing_count} missing, {result.stale_count}{" "}
          stale). Playlist stats recomputed.
        </div>
      )}
    </div>
  );
}
