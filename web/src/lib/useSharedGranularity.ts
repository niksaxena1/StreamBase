"use client";

import { useState, useEffect, useCallback } from "react";
import type { Granularity } from "@/components/ui/GranularitySelect";

const EVENT_NAME = "sb:granularity-change";
const VALID = ["daily", "weekly", "monthly", "quarterly", "yearly"];

function readStorage(key: string): Granularity {
  if (typeof window === "undefined") return "daily";
  try {
    const v = localStorage.getItem(key);
    if (v && VALID.includes(v)) return v as Granularity;
  } catch {}
  return "daily";
}

/**
 * Shared granularity state backed by localStorage + custom DOM events.
 * Multiple components on the same page using the same `storageKey`
 * will stay in sync without needing a common React parent or context.
 */
export function useSharedGranularity(storageKey: string) {
  const [granularity, setInternal] = useState<Granularity>(() => readStorage(storageKey));

  const setGranularity = useCallback(
    (g: Granularity) => {
      setInternal(g);
      try { localStorage.setItem(storageKey, g); } catch {}
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { key: storageKey, value: g } }));
    },
    [storageKey],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const { key, value } = (e as CustomEvent).detail ?? {};
      if (key === storageKey && VALID.includes(value)) {
        setInternal(value as Granularity);
      }
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, [storageKey]);

  return [granularity, setGranularity] as const;
}
