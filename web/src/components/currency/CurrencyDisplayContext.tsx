"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { setCurrencyDisplay, type CurrencyDisplay } from "@/lib/format";

type CurrencyDisplayState = {
  currencyDisplay: CurrencyDisplay;
  loading: boolean;
  configured: boolean;
  error: string | null;
  refetch: () => void;
};

const CurrencyDisplayContext = createContext<CurrencyDisplayState | null>(null);

async function fetchCurrencyDisplay() {
  const res = await fetch("/api/user-settings/currency-display", { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load currency setting");
  const raw = String((data as any)?.currency_display ?? "USD").toUpperCase();
  const currencyDisplay: CurrencyDisplay = raw === "AED" ? "AED" : "USD";
  return { currencyDisplay, configured: (data as any)?.configured !== false };
}

export function CurrencyDisplayProvider({ children }: { children: ReactNode }) {
  const [currencyDisplay, setCurrencyDisplayState] = useState<CurrencyDisplay>("USD");
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = () => setNonce((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    void fetchCurrencyDisplay()
      .then((r) => {
        if (!alive) return;
        setCurrencyDisplayState(r.currencyDisplay);
        setConfigured(r.configured);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load currency setting");
        setConfigured(true);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [nonce]);

  // Keep the global formatter mode in sync for helpers that live outside React.
  // NOTE: This is intentionally done during render (not in an effect) so that any
  // render using this provider sees the correct currency mode immediately.
  setCurrencyDisplay(currencyDisplay);

  // Listen for updates triggered by the Settings page.
  useEffect(() => {
    function onUpdated() {
      refetch();
    }
    window.addEventListener("sb:currency-display-updated", onUpdated as any);
    return () => window.removeEventListener("sb:currency-display-updated", onUpdated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<CurrencyDisplayState>(
    () => ({ currencyDisplay, loading, configured, error, refetch }),
    [currencyDisplay, loading, configured, error],
  );

  return <CurrencyDisplayContext.Provider value={value}>{children}</CurrencyDisplayContext.Provider>;
}

export function useCurrencyDisplay() {
  const ctx = useContext(CurrencyDisplayContext);
  if (!ctx) throw new Error("useCurrencyDisplay must be used within CurrencyDisplayProvider");
  return ctx;
}

