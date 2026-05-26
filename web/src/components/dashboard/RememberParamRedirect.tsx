"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ChartSkeleton, Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { readDatasetSelectionStorage } from "@/lib/datasetSelectionStorage";

export function RememberParamRedirect(props: {
  param: string;
  storageKey: string;
  /** Optional legacy key before dataset_mode scoping (one-time migration). */
  legacyStorageKey?: string;
  defaultValue?: string | null;
  loadingTitle?: string;
  loadingSubtitle?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
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

    const remembered = props.legacyStorageKey
      ? readDatasetSelectionStorage(props.storageKey, props.legacyStorageKey)
      : (() => {
          try {
            return localStorage.getItem(props.storageKey);
          } catch {
            return null;
          }
        })();

    const value = (remembered ?? props.defaultValue ?? "").trim();
    if (!value) return;

    const next = new URLSearchParams(sp.toString());
    next.set(props.param, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, props.defaultValue, props.legacyStorageKey, props.param, props.storageKey, router, sp]);

  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="min-w-0">
            <div className="text-sm font-medium" style={{ color: "var(--sb-text)" }}>
              {props.loadingTitle ?? "Loading..."}
            </div>
            {props.loadingSubtitle ? (
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                {props.loadingSubtitle}
              </div>
            ) : null}
          </div>
        </div>
        <Skeleton className="h-9 w-44 rounded-lg" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton height={210} />
        <ChartSkeleton height={210} />
      </div>
      <TableSkeleton rows={7} cols={6} />
      {fallbackHref ? (
        <a
          href={fallbackHref}
          className="inline-flex items-center justify-center rounded-full px-3 py-1.5 text-xs font-medium sb-ring transition hover:opacity-90"
          style={{ background: "var(--sb-surface)", color: "var(--sb-text)" }}
        >
          Continue
        </a>
      ) : null}
    </div>
  );
}
