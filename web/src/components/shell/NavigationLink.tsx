"use client";

import Link, { useLinkStatus } from "next/link";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { triggerRouteLoadingBarDone, triggerRouteLoadingBarStart } from "@/lib/navigation/loadingBar";

function NavigationCompletion({ complete }: { complete: () => void }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) complete();
    wasPending.current = pending;
  }, [pending, complete]);
  return null;
}

/** Urgent clicked state is independent of the suspended RSC navigation transition. */
export function NavigationLink({ children, className, onNavigate, ...props }: ComponentProps<typeof Link>) {
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const navigationId = useRef<number | undefined>(undefined);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = `${pathname}?${search}`;
  const pending = pendingRoute === route;
  useEffect(() => { setPendingRoute(null); }, [route]);
  const complete = useCallback(() => { setPendingRoute(null); triggerRouteLoadingBarDone(navigationId.current); }, []);
  return (
    <Link {...props} prefetch={true}
      className={[className, pending ? "ring-2 ring-[var(--sb-accent)] bg-[var(--sb-accent-10)]" : ""].filter(Boolean).join(" ")}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      onNavigate={(event) => {
        onNavigate?.(event);
        const href = String(props.href);
        const target = new URL(href, window.location.href);
        if (target.pathname + target.search === window.location.pathname + window.location.search) return;
        setPendingRoute(route);
        navigationId.current = triggerRouteLoadingBarStart(href);
      }}>
      {children}
      <NavigationCompletion complete={complete} />
    </Link>
  );
}
