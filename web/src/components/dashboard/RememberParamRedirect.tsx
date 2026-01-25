"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function RememberParamRedirect(props: {
  param: string;
  storageKey: string;
  defaultValue?: string | null;
  loadingTitle?: string;
  loadingSubtitle?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

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
    router.replace(`${pathname}?${next.toString()}`);
  }, [pathname, props.defaultValue, props.param, props.storageKey, router, sp]);

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
    </div>
  );
}

