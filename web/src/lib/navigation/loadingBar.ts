import { isRouteDestination } from "./navigationRules";
export const SB_ROUTE_LOADING_BAR_START_EVENT = "sb:route-loading-bar:start" as const;
export const SB_ROUTE_LOADING_BAR_DONE_EVENT = "sb:route-loading-bar:done" as const;
let navigationId = 0;
let safety: ReturnType<typeof setTimeout> | undefined;

/** Start feedback for an internal pathname or search-param navigation. */
export function triggerRouteLoadingBarStart(href?: string) {
  if (typeof window === "undefined") return;

  if (href && !isRouteDestination(href, window.location.href)) return;

  const id = ++navigationId;
  clearTimeout(safety);
  // Canceled transitions and redirects to this same URL can have no route commit.
  safety = setTimeout(() => triggerRouteLoadingBarDone(id), 8000);
  window.dispatchEvent(new CustomEvent(SB_ROUTE_LOADING_BAR_START_EVENT));
  return id;
}

/**
 * Manually finish the global top loading bar. Use this when triggering work that does NOT
 * change the pathname (e.g. `router.refresh()`), where the auto-completion on pathname
 * change wouldn't fire.
 */
export function triggerRouteLoadingBarDone(id?: number) {
  if (typeof window === "undefined") return;
  // A canceled/older transition must not finish a newer navigation's feedback.
  if (id !== undefined && id !== navigationId) return;
  clearTimeout(safety);
  window.dispatchEvent(new CustomEvent(SB_ROUTE_LOADING_BAR_DONE_EVENT));
}

