"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LoadingState } from "@/components/ui/Skeleton";
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
    <div className="sb-card flex min-h-52 flex-col items-center justify-center gap-1 p-6" aria-busy="true">
      <LoadingState
        message={props.loadingSubtitle ?? props.loadingTitle ?? "Loading…"}
        className="py-4"
      />
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
