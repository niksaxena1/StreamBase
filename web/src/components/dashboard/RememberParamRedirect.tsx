"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function RememberParamRedirect(props: {
  param: string;
  storageKey: string;
  defaultValue?: string | null;
  loadingTitle?: string;
  loadingSubtitle?: string;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();

  // Server-renderable fallback target (uses defaultValue only; localStorage is client-only).
  const fallbackHref = (() => {
    const dv = (props.defaultValue ?? "").trim();
    if (!dv) return null;
    try {
      const next = new URLSearchParams(sp.toString());
      next.set(props.param, dv);
      return `${pathname}?${next.toString()}`;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (sp.get(props.param)) return;

    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(props.storageKey);
    } catch {
      // ignore
    }

    const value = (remembered ?? props.defaultValue ?? "").trim();
    if (!value) return;

    const next = new URLSearchParams(sp.toString());
    next.set(props.param, value);
    const href = `${pathname}?${next.toString()}`;
    // Use a hard navigation instead of Next router to avoid hydration/router edge cases.
    try {
      window.location.replace(href);
    } catch {
      // ignore
    }
  }, [pathname, props.defaultValue, props.param, props.storageKey, sp]);

  return (
    <div className="sb-card p-4">
      <div className="text-xs font-medium">
        {props.loadingTitle ?? "Loading…"}
      </div>
      {props.loadingSubtitle ? (
        <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          {props.loadingSubtitle}
        </div>
      ) : null}
      <div className="mt-3 h-8 w-40 animate-pulse rounded-xl bg-white/30 dark:bg-white/10" />
      {fallbackHref ? (
        <a
          href={fallbackHref}
          className="mt-3 inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium sb-ring transition hover:opacity-90"
          style={{ background: "var(--sb-surface)", color: "var(--sb-text)" }}
        >
          Continue
        </a>
      ) : null}
    </div>
  );
}

