"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { WeekdayIndexUtc } from "@/components/charts/chartUtils";

const DEFAULT_HIGHLIGHT_DAY_UTC: WeekdayIndexUtc = 0; // Sunday

type WeekHighlightState = {
  weekHighlightDayUtc: WeekdayIndexUtc;
  loading: boolean;
  configured: boolean;
  error: string | null;
  refetch: () => void;
};

const WeekHighlightContext = createContext<WeekHighlightState | null>(null);

function normalizeWeekdayIndexUtc(n: unknown): WeekdayIndexUtc {
  const v = Number(n);
  const i = Number.isFinite(v) ? Math.trunc(v) : DEFAULT_HIGHLIGHT_DAY_UTC;
  return (i === 0 || i === 1 || i === 2 || i === 3 || i === 4 || i === 5 || i === 6) ? i : DEFAULT_HIGHLIGHT_DAY_UTC;
}

async function fetchHighlightDay() {
  const res = await fetch("/api/user-settings/week-highlight-day", { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load highlight day");

  return {
    weekHighlightDayUtc: normalizeWeekdayIndexUtc((data as any)?.chart_week_highlight_day),
    configured: (data as any)?.configured !== false,
  };
}

export function WeekHighlightProvider({ children }: { children: ReactNode }) {
  const [weekHighlightDayUtc, setWeekHighlightDayUtc] = useState<WeekdayIndexUtc>(DEFAULT_HIGHLIGHT_DAY_UTC);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    void fetchHighlightDay()
      .then((r) => {
        if (!alive) return;
        setWeekHighlightDayUtc(r.weekHighlightDayUtc);
        setConfigured(r.configured);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load highlight day");
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
    window.addEventListener("sb:week-highlight-day-updated", onUpdated as any);
    return () => window.removeEventListener("sb:week-highlight-day-updated", onUpdated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<WeekHighlightState>(
    () => ({ weekHighlightDayUtc, loading, configured, error, refetch }),
    [weekHighlightDayUtc, loading, configured, error],
  );

  return <WeekHighlightContext.Provider value={value}>{children}</WeekHighlightContext.Provider>;
}

export function useWeekHighlight() {
  const ctx = useContext(WeekHighlightContext);
  if (!ctx) throw new Error("useWeekHighlight must be used within WeekHighlightProvider");
  return ctx;
}

