"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { DEFAULT_CHART_START_DATE_ISO, normalizeIsoDateOrNull } from "@/components/charts/chartUtils";

type ChartStartDateState = {
  chartStartDateIso: string; // always normalized YYYY-MM-DD
  loading: boolean;
  configured: boolean;
  error: string | null;
  refetch: () => void;
};

const ChartStartDateContext = createContext<ChartStartDateState | null>(null);

async function fetchChartStartDate() {
  const res = await fetch("/api/user-settings/chart-start-date", { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load chart start date");

  const fromApi = normalizeIsoDateOrNull((data as any)?.chart_start_date);
  return {
    chartStartDateIso: fromApi ?? DEFAULT_CHART_START_DATE_ISO,
    configured: (data as any)?.configured !== false,
  };
}

export function ChartStartDateProvider({ children }: { children: ReactNode }) {
  const [chartStartDateIso, setChartStartDateIso] = useState<string>(DEFAULT_CHART_START_DATE_ISO);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    void fetchChartStartDate()
      .then((r) => {
        if (!alive) return;
        setChartStartDateIso(r.chartStartDateIso);
        setConfigured(r.configured);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load chart start date");
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
    window.addEventListener("sb:chart-start-date-updated", onUpdated as any);
    return () => window.removeEventListener("sb:chart-start-date-updated", onUpdated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<ChartStartDateState>(
    () => ({ chartStartDateIso, loading, configured, error, refetch }),
    [chartStartDateIso, loading, configured, error],
  );

  return <ChartStartDateContext.Provider value={value}>{children}</ChartStartDateContext.Provider>;
}

export function useChartStartDate() {
  const ctx = useContext(ChartStartDateContext);
  if (!ctx) throw new Error("useChartStartDate must be used within ChartStartDateProvider");
  return ctx;
}

