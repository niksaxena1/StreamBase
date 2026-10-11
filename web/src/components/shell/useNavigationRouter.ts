"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerRouteLoadingBarDone, triggerRouteLoadingBarStart } from "@/lib/navigation/loadingBar";

/** Programmatic navigations share the same immediate feedback as anchor clicks. */
export function useNavigationRouter() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const wasPending = useRef(false);
  const navigationId = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wasPending.current && !pending && navigationId.current !== undefined) triggerRouteLoadingBarDone(navigationId.current);
    wasPending.current = pending;
  }, [pending]);
  return useMemo(() => ({
    ...router,
    refresh: () => {
      navigationId.current = triggerRouteLoadingBarStart();
      startTransition(() => router.refresh());
    },
    push: (...args: Parameters<typeof router.push>) => {
      navigationId.current = triggerRouteLoadingBarStart(args[0]);
      startTransition(() => router.push(...args));
    },
    replace: (...args: Parameters<typeof router.replace>) => {
      navigationId.current = triggerRouteLoadingBarStart(args[0]);
      startTransition(() => router.replace(...args));
    },
  }), [router, startTransition]);
}
