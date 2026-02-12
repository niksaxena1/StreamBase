"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";

type HistoryEntry = {
  date: string;
  warnings: Record<string, number>;
};

/** Readable labels for warning codes. */
const CODE_LABELS: Record<string, string> = {
  catalog_missing_stream_snapshots: "Missing Snapshots",
  catalog_streams_missing_prev_nonzero: "Missing Prev Nonzero",
  stale_source_data: "Stale Source",
  individual_tracks_stale: "Stale Tracks",
  excluded_track_streams_zeroed: "Excluded Zeroed",
  total_streams_decreased: "Streams Decreased",
  track_count_swing: "Track Count Swing",
  non_catalog_tracks_present: "Non-Catalog Tracks",
  high_zero_stream_rate: "High Zero Rate",
  entity_distro_drift: "Entity/Distro Drift",
  distro_overlap: "Distro Overlap",
  ingestion_exception: "Exception",
};

/** Distinct colors for each code. */
const CODE_COLORS: Record<string, string> = {
  catalog_missing_stream_snapshots: "#ef4444",
  catalog_streams_missing_prev_nonzero: "#f97316",
  stale_source_data: "#eab308",
  individual_tracks_stale: "#a855f7",
  excluded_track_streams_zeroed: "#ec4899",
  total_streams_decreased: "#dc2626",
  track_count_swing: "#3b82f6",
  non_catalog_tracks_present: "#6366f1",
  high_zero_stream_rate: "#14b8a6",
  entity_distro_drift: "#f59e0b",
  distro_overlap: "#8b5cf6",
  ingestion_exception: "#b91c1c",
};

/** Convert run_date (YYYY-MM-DD) to data_date by subtracting SOT lag (2 days). */
function runDateToDataDate(runDate: string): string {
  const d = new Date(runDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

export function WarningHistoryChart() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dates, setDates] = useState<HistoryEntry[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/health-history");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as any)?.error ?? "Failed");
        setDates((data as any)?.dates ?? []);
        setCodes((data as any)?.codes ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Navigate to /health?date=<dataDate> when a bar is clicked, and scroll to top
  const handleBarClick = useCallback(
    (data: any) => {
      const runDate = data?.date ?? data?.activeLabel;
      if (!runDate || typeof runDate !== "string") return;
      const dataDate = runDateToDataDate(runDate);
      router.push(`/health?date=${dataDate}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  if (loading) {
    return (
      <div className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5">
        <h3 className="text-sm font-semibold mb-1">Warning History</h3>
        <div className="text-xs opacity-60">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5">
        <h3 className="text-sm font-semibold mb-1">Warning History</h3>
        <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
      </div>
    );
  }

  if (dates.length === 0) {
    return (
      <div className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5">
        <h3 className="text-sm font-semibold mb-1">Warning History</h3>
        <div className="text-xs opacity-60">No warning data in the last 30 days.</div>
      </div>
    );
  }

  // Transform data for Recharts: each date becomes an object with code counts
  const chartData = dates.map((d) => ({
    date: d.date,
    ...d.warnings,
  }));

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5">
      <h3 className="text-sm font-semibold mb-1">Warning History</h3>
      <p className="text-xs opacity-70 mb-3">
        Warning counts per day over the past 30 days (critical/warn only).
        Click a bar to view that day&apos;s warnings.
      </p>

      <div className="w-full cursor-pointer" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            onClick={(state) => {
              if (state?.activeLabel) {
                handleBarClick({ date: state.activeLabel });
              }
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--sb-border)"
            />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                const d = new Date(v);
                return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
              }}
              stroke="var(--sb-muted)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickMargin={4}
            />
            <YAxis
              stroke="var(--sb-muted)"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--sb-surface, #1a1a1a)",
                border: "1px solid var(--sb-border, #333)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(v) => `${String(v)} (click to view)`}
              formatter={(value: number, name: string) => [
                value,
                CODE_LABELS[name] ?? name,
              ]}
            />
            <Legend
              iconSize={8}
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value: string) => CODE_LABELS[value] ?? value}
            />
            {codes.map((code) => (
              <Bar
                key={code}
                dataKey={code}
                stackId="warnings"
                fill={CODE_COLORS[code] ?? "#888"}
                name={code}
                radius={[0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
