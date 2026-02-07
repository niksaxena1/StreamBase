export const SB_ROUTE_LOADING_BAR_START_EVENT = "sb:route-loading-bar:start" as const;

/**
 * Start the global top loading bar for *route* navigations (pathname changes).
 *
 * - If `href` is provided, we only trigger when the URL's pathname changes.
 * - This intentionally ignores search-param-only changes to avoid noisy UI.
 */
export function triggerRouteLoadingBarStart(href?: string) {
  if (typeof window === "undefined") return;

  if (href) {
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
    } catch {
      // If `href` isn't a URL we can parse, default to triggering.
    }
  }

  window.dispatchEvent(new CustomEvent(SB_ROUTE_LOADING_BAR_START_EVENT));
}

