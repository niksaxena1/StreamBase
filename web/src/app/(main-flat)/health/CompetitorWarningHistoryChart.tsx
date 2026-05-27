"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fetchApiJson } from "@/lib/api";

type HistoryEntry = {
  date: string;
  data_date: string;
  warnings: Record<string, number>;
  detected: number;
};

const FALLBACK_COLORS = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#8b5cf6", "#14b8a6"];

export function CompetitorWarningHistoryChart() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [dates, setDates] = useState<HistoryEntry[]>([]);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const data = await fetchApiJson<{ dates: HistoryEntry[]; codes: string[] }>(
          "/api/competitor-health-history",
        );
        setDates(data.dates ?? []);
        setCodes(data.codes ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleBarClick = useCallback(
    (payload: { data_date?: string }) => {
      const dataDate = payload?.data_date;
      if (!dataDate) return;
      router.push(`/health?date=${dataDate}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  if (loading) {
    return (
      <div className="sb-card p-4">
        <div className="text-xs font-medium uppercase tracking-wider opacity-60">Warning history</div>
        <div className="mt-2 text-xs opacity-60">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sb-card p-4 text-xs text-red-500">
        Warning history: {error}
      </div>
    );
  }

  if (!dates.length) {
    return (
      <div className="sb-card p-4">
        <div className="text-xs font-medium uppercase tracking-wider opacity-60">Warning history</div>
        <div className="mt-2 text-xs opacity-60">No competitor warnings in the last 30 days.</div>
      </div>
    );
  }

  const chartData = dates.map((d) => {
    const row: Record<string, string | number> = {
      label: d.data_date,
      data_date: d.data_date,
      total: d.detected,
    };
    for (const code of codes) {
      row[code] = d.warnings[code] ?? 0;
    }
    return row;
  });

  return (
    <div className="sb-card p-4 space-y-2">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider opacity-60">Warning history</div>
        <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Last 30 days · click a bar to jump to that data date
        </div>
      </div>
      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip labelFormatter={(label) => `Data date ${label}`} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {codes.map((code, i) => (
              <Bar
                key={code}
                dataKey={code}
                name={code}
                stackId="warnings"
                fill={FALLBACK_COLORS[i % FALLBACK_COLORS.length]}
                className="cursor-pointer"
                onClick={(row) => {
                  const payload = row as { data_date?: string };
                  if (payload?.data_date) handleBarClick(payload);
                }}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
