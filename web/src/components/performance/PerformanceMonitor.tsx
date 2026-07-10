"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Metric = {
  name: string;
  value: number;
  unit: "ms" | "score";
  path: string;
  datasetMode: "own" | "competitor" | null;
  detail?: Record<string, string | number | boolean | null>;
};
const queue: Metric[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  if (!queue.length) return;
  const metrics = queue.splice(0, 30);
  const body = JSON.stringify({ metrics });
  if (
    !navigator.sendBeacon?.(
      "/api/performance",
      new Blob([body], { type: "application/json" }),
    )
  ) {
    void fetch("/api/performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}

function publish(
  name: string,
  value: number,
  detail?: Record<string, string | number | boolean | null>,
  unit: "ms" | "score" = "ms",
) {
  if (!Number.isFinite(value) || value < 0) return;
  const datasetMode =
    document.querySelector<HTMLElement>("[data-mode]")?.dataset.mode;
  const metric: Metric = {
    name,
    value,
    unit,
    path: window.location.pathname,
    datasetMode:
      datasetMode === "own" || datasetMode === "competitor"
        ? datasetMode
        : null,
    detail,
  };
  window.dispatchEvent(
    new CustomEvent("sb:performance", {
      detail: { name, value, path: window.location.pathname, ...detail },
    }),
  );
  if (process.env.NODE_ENV === "development")
    console.debug(`[performance] ${name} ${value.toFixed(1)}ms`, detail ?? "");
  if (Math.random() <= 0.2) {
    queue.push(metric);
    if (!flushTimer) flushTimer = setTimeout(flush, 5000);
  }
}

export function PerformanceMonitor() {
  const pathname = usePathname();

  useEffect(() => {
    performance.mark(`sb:route:${pathname}:ready`);
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (navigation)
      publish("route-ready", performance.now(), {
        pathname,
        ttfb: navigation.responseStart,
      });
  }, [pathname]);

  useEffect(() => {
    if (!("PerformanceObserver" in window)) return;
    const observers: PerformanceObserver[] = [];
    const observe = (type: string) => {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const value =
              type === "layout-shift" && "value" in entry
                ? Number(entry.value)
                : entry.duration || entry.startTime;
            publish(
              type,
              value,
              { entry: entry.name.slice(0, 120) },
              type === "layout-shift" ? "score" : "ms",
            );
          }
        });
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        /* unsupported entry type */
      }
    };
    ["largest-contentful-paint", "layout-shift", "longtask"].forEach(observe);
    const onPageHide = () => flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}

export function SectionPerformance({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const ready = `sb:section:${name}:ready`;
    performance.mark(ready);
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    publish(
      "section-ready",
      Math.max(0, performance.now() - (navigation?.responseStart ?? 0)),
      { section: name.slice(0, 120) },
    );
    return () => performance.clearMarks(ready);
  }, [name]);
  return children;
}
