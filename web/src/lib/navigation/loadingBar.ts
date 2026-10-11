export const SB_ROUTE_LOADING_BAR_START_EVENT = "sb:route-loading-bar:start" as const;
export const SB_ROUTE_LOADING_BAR_DONE_EVENT = "sb:route-loading-bar:done" as const;
let navigationId = 0;

/** Start feedback for an internal pathname or search-param navigation. */
export function triggerRouteLoadingBarStart(href?: string) {
  if (typeof window === "undefined") return;

  if (href) {
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
    } catch {
      // If `href` isn't a URL we can parse, default to triggering.
    }
  }

  const id = ++navigationId;
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
  window.dispatchEvent(new CustomEvent(SB_ROUTE_LOADING_BAR_DONE_EVENT));
}

