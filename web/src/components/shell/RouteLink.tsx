"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, type ComponentProps } from "react";
import { triggerRouteLoadingBarDone, triggerRouteLoadingBarStart } from "@/lib/navigation/loadingBar";
import { shouldStartLinkNavigation } from "@/lib/navigation/navigationRules";

function Completion({ navigationId }: { navigationId: React.RefObject<number | undefined> }) {
  const { pending } = useLinkStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && navigationId.current !== undefined) triggerRouteLoadingBarDone(navigationId.current);
    wasPending.current = pending;
  }, [pending, navigationId]);
  return null;
}

/** Next calls onNavigate only for client navigation, after onClick has had a chance to cancel. */
export default function RouteLink({ children, onNavigate, ...props }: ComponentProps<typeof Link>) {
  const navigationId = useRef<number | undefined>(undefined);
  return <Link {...props} onNavigate={(event) => {
    let prevented = false;
    onNavigate?.({ preventDefault: () => { prevented = true; event.preventDefault(); } });
    if (shouldStartLinkNavigation(String(props.href), window.location.href, { defaultPrevented: prevented }, {
      download: props.download !== undefined && props.download !== false,
      target: props.target,
      disabled: (props as Record<string, unknown>)["data-sb-no-top-loader"] === "true",
    })) navigationId.current = triggerRouteLoadingBarStart(String(props.href));
  }}>{children}<Completion navigationId={navigationId} /></Link>;
}
