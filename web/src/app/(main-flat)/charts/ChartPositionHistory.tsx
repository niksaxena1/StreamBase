"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useThemeColors } from "@/components/charts/useThemeColors";
import { isApiSuccess, type ApiResponse } from "@/lib/api";
import { buildHistorySeries, type HistoryChartPoint, type HistoryPoint } from "@/lib/charts/chartsModel";

const historyCache = new Map<string, HistoryPoint[]>();

/** Last-90-days position mini chart for one charted track. #1 is at the top; absent days are gaps. */
export function ChartPositionHistory({
  source,
  sourceTrackId,
  endDate,
}: {
  source: string;
  sourceTrackId: number;
  endDate: string;
}) {
  const colors = useThemeColors();
  const key = `${source}:${sourceTrackId}`;
  const [points, setPoints] = useState<HistoryPoint[] | null>(historyCache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (historyCache.has(key)) return;
    let cancelled = false;
    fetch(`/api/charts/history?source=${encodeURIComponent(source)}&id=${sourceTrackId}&days=90`)
      .then((r) => r.json() as Promise<ApiResponse<HistoryPoint[]>>)
      .then((res) => {
        if (cancelled) return;
        if (!isApiSuccess(res)) {
          setFailed(true);
          return;
        }
        historyCache.set(key, res.data);
        setPoints(res.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, source, sourceTrackId]);

  if (failed) {
    return (
      <div className="py-3 text-xs" style={{ color: "var(--sb-muted)" }}>
        Position history could not be loaded.
      </div>
    );
  }
  if (!points) {
    return (
      <div className="py-3 text-xs" style={{ color: "var(--sb-muted)" }}>
        Loading position history…
      </div>
    );
  }
  const series: HistoryChartPoint[] = buildHistorySeries(points, endDate, 90);
  if (series.filter((p) => p.position != null).length === 0) {
    return (
      <div className="py-3 text-xs" style={{ color: "var(--sb-muted)" }}>
        No position history yet.
      </div>
    );
  }
  const worst = Math.max(...series.map((p) => p.position ?? 1));
  const yMax = Math.max(10, Math.ceil(worst / 10) * 10);

  return (
    <div className="h-32 w-full" aria-label="Chart position, last 90 days">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colors.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: colors.muted, fontSize: 10 }}
            tickFormatter={(d: string) => d.slice(5)}
            minTickGap={32}
            stroke={colors.border}
          />
          <YAxis
            reversed
            domain={[1, yMax]}
            allowDecimals={false}
            width={28}
            tick={{ fill: colors.muted, fontSize: 10 }}
            stroke={colors.border}
          />
          <Tooltip
            formatter={(v) => [v == null ? "off chart" : `#${v}`, "Position"]}
            labelFormatter={(l) => String(l)}
            contentStyle={{
              background: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              fontSize: 11,
              color: colors.text,
            }}
          />
          <Line
            type="monotone"
            dataKey="position"
            stroke={colors.accentStroke}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
