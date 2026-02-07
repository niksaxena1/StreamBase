"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { fetchUserSettingsBundle, invalidateUserSettingsBundle } from "@/lib/userSettingsBundleFetch";

const DEFAULT_RATE_PER_K_USD = 2.0;

type PayoutRateState = {
  streamPayoutRatePerKUsd: number;
  streamPayoutPerStreamUsd: number;
  loading: boolean;
  configured: boolean;
  error: string | null;
  refetch: () => void;
};

const PayoutRateContext = createContext<PayoutRateState | null>(null);

async function fetchRate() {
  const data = await fetchUserSettingsBundle();
  const ratePerK = Number(data.stream_payout_rate_per_k_usd ?? DEFAULT_RATE_PER_K_USD);
  return {
    streamPayoutRatePerKUsd: Number.isFinite(ratePerK) ? ratePerK : DEFAULT_RATE_PER_K_USD,
    configured: data.configured !== false,
  };
}

export function PayoutRateProvider({ children }: { children: ReactNode }) {
  const [streamPayoutRatePerKUsd, setStreamPayoutRatePerKUsd] = useState<number>(DEFAULT_RATE_PER_K_USD);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => {
    invalidateUserSettingsBundle();
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void fetchRate()
      .then((r) => {
        if (!alive) return;
        setStreamPayoutRatePerKUsd(r.streamPayoutRatePerKUsd);
        setConfigured(r.configured);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load rate");
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
    window.addEventListener("sb:payout-rate-updated", onUpdated as any);
    return () => window.removeEventListener("sb:payout-rate-updated", onUpdated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const streamPayoutPerStreamUsd = useMemo(() => streamPayoutRatePerKUsd / 1000, [streamPayoutRatePerKUsd]);

  const value = useMemo<PayoutRateState>(
    () => ({
      streamPayoutRatePerKUsd,
      streamPayoutPerStreamUsd,
      loading,
      configured,
      error,
      refetch,
    }),
    [streamPayoutRatePerKUsd, streamPayoutPerStreamUsd, loading, configured, error],
  );

  return <PayoutRateContext.Provider value={value}>{children}</PayoutRateContext.Provider>;
}

export function usePayoutRate() {
  const ctx = useContext(PayoutRateContext);
  if (!ctx) throw new Error("usePayoutRate must be used within PayoutRateProvider");
  return ctx;
}

