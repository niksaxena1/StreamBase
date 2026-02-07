"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ChartAxisZoomState = {
  zoomDailyYAxis: boolean;
  zoomDailyYAxisCollectorComparison: boolean;
  loading: boolean;
  configured: boolean;
  error: string | null;
  refetch: () => void;
};

const ChartAxisZoomContext = createContext<ChartAxisZoomState | null>(null);

const DEFAULT_ZOOM_DAILY = true;
const DEFAULT_ZOOM_COLLECTOR_COMPARISON = true;

async function fetchAxisZoomSettings() {
  const res = await fetch("/api/user-settings/chart-y-axis-zoom", { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load chart axis zoom settings");

  const zoomDaily = (data as any)?.chart_zoom_daily_y_axis;
  const zoomCollector = (data as any)?.chart_zoom_daily_y_axis_collector_comparison;

  return {
    zoomDailyYAxis: typeof zoomDaily === "boolean" ? zoomDaily : DEFAULT_ZOOM_DAILY,
    zoomDailyYAxisCollectorComparison:
      typeof zoomCollector === "boolean" ? zoomCollector : DEFAULT_ZOOM_COLLECTOR_COMPARISON,
    configured: (data as any)?.configured !== false,
  };
}

export function ChartAxisZoomProvider({ children }: { children: ReactNode }) {
  const [zoomDailyYAxis, setZoomDailyYAxis] = useState(DEFAULT_ZOOM_DAILY);
  const [zoomDailyYAxisCollectorComparison, setZoomDailyYAxisCollectorComparison] = useState(
    DEFAULT_ZOOM_COLLECTOR_COMPARISON,
  );
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    void fetchAxisZoomSettings()
      .then((r) => {
        if (!alive) return;
        setZoomDailyYAxis(r.zoomDailyYAxis);
        setZoomDailyYAxisCollectorComparison(r.zoomDailyYAxisCollectorComparison);
        setConfigured(r.configured);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load chart axis zoom settings");
        setConfigured(true);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [nonce]);

  useEffect(() => {
    function onUpdated() {
      refetch();
    }
    window.addEventListener("sb:chart-axis-zoom-updated", onUpdated as any);
    return () => window.removeEventListener("sb:chart-axis-zoom-updated", onUpdated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ChartAxisZoomState>(
    () => ({
      zoomDailyYAxis,
      zoomDailyYAxisCollectorComparison,
      loading,
      configured,
      error,
      refetch,
    }),
    [zoomDailyYAxis, zoomDailyYAxisCollectorComparison, loading, configured, error],
  );

  return <ChartAxisZoomContext.Provider value={value}>{children}</ChartAxisZoomContext.Provider>;
}

export function useChartAxisZoom() {
  const ctx = useContext(ChartAxisZoomContext);
  if (!ctx) throw new Error("useChartAxisZoom must be used within ChartAxisZoomProvider");
  return ctx;
}

