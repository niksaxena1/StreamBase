"use client";

import RouteLink from "./RouteLink";
import { useEffect, useState, type ComponentProps } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SB_ROUTE_LOADING_BAR_DONE_EVENT } from "@/lib/navigation/loadingBar";
import { isRouteDestination } from "@/lib/navigation/navigationRules";

/** Prefetch only on fresh pointer/focus intent, including after cache invalidation. */
export function NavigationLink({ children, className, onNavigate, onPointerEnter, onFocus, ...props }: ComponentProps<typeof RouteLink>) {
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const route = `${pathname}?${search}`;
  const pending = pendingRoute === route;
  useEffect(() => {
    const complete = () => setPendingRoute(null);
    window.addEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, complete);
    return () => window.removeEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, complete);
  }, []);
  const prefetch = () => {
    const href = String(props.href);
    if (isRouteDestination(href, window.location.href)) router.prefetch(href);
  };
  return <RouteLink {...props} prefetch={false}
    onPointerEnter={(event) => { onPointerEnter?.(event); if (!event.defaultPrevented) prefetch(); }}
    onFocus={(event) => { onFocus?.(event); if (!event.defaultPrevented) prefetch(); }}
    className={[className, pending ? "ring-2 ring-[var(--sb-accent)] bg-[var(--sb-accent-10)]" : ""].filter(Boolean).join(" ")}
    aria-busy={pending || undefined} data-pending={pending || undefined}
    onNavigate={(event) => {
      let prevented = false;
      onNavigate?.({ preventDefault: () => { prevented = true; event.preventDefault(); } });
      if (!prevented && isRouteDestination(String(props.href), window.location.href)) setPendingRoute(route);
    }}>{children}</RouteLink>;
}
