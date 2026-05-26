"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const SAIWidget = dynamic(
  () => import("@/components/sai/SAIWidget").then(m => ({ default: m.SAIWidget })),
  { ssr: false }
);

export function LazyAIWidget() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => win.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  if (!ready) return null;
  return <SAIWidget />;
}
