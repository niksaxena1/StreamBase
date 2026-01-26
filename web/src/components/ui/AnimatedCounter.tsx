"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Format = "int" | "usd" | "raw";

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function fmt(
  n: number,
  format: Format,
  usdMaximumFractionDigits: number,
  usdMinimumFractionDigits: number,
) {
  if (format === "raw") return String(n);
  if (format === "usd") {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: usdMaximumFractionDigits,
        minimumFractionDigits: usdMinimumFractionDigits,
      }).format(n);
    } catch {
      const rounded =
        usdMaximumFractionDigits <= 0
          ? Math.round(n)
          : Number(n.toFixed(usdMaximumFractionDigits));
      return `$${rounded.toLocaleString("en-US", {
        minimumFractionDigits: usdMinimumFractionDigits,
        maximumFractionDigits: usdMaximumFractionDigits,
      })}`;
    }
  }
  // int
  try {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  } catch {
    return false;
  }
}

export function AnimatedCounter({
  value,
  durationMs = 650,
  format = "int",
  usdMaximumFractionDigits,
  usdMinimumFractionDigits,
}: {
  value: number;
  durationMs?: number;
  format?: Format;
  usdMaximumFractionDigits?: number;
  usdMinimumFractionDigits?: number;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const maxUsdDigits = usdMaximumFractionDigits ?? 0;
  const minUsdDigits = usdMinimumFractionDigits ?? (maxUsdDigits > 0 ? maxUsdDigits : 0);

  // SSR-safe: render the final value on the server to avoid hydration mismatch.
  const [display, setDisplay] = useState<number>(safeValue);
  const mountedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const formatted = useMemo(
    () => fmt(display, format, maxUsdDigits, minUsdDigits),
    [display, format, maxUsdDigits, minUsdDigits],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    // First paint: sync without animation to avoid mismatch.
    if (!mountedRef.current) {
      setDisplay(safeValue);
      return;
    }

    if (prefersReducedMotion() || durationMs <= 0) {
      setDisplay(safeValue);
      return;
    }

    const from = display;
    const to = safeValue;
    if (from === to) return;

    const start = performance.now();

    function step(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeOutCubic(t);
      const next = from + (to - from) * eased;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeValue, durationMs, format]);

  return <span suppressHydrationWarning>{formatted}</span>;
}

