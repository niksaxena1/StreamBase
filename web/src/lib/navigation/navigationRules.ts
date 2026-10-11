type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
type Anchor = { download?: boolean; target?: string; disabled?: boolean };

/** Shared by actual Next onNavigate callbacks, route pushes, and intent prefetch. */
export function isRouteDestination(href: string, currentHref: string): boolean {
  try {
    const current = new URL(currentHref);
    const target = new URL(href, current);
    if (!/^https?:$/.test(target.protocol) || target.origin !== current.origin) return false;
    if (/^\/api(?:\/|$)/.test(target.pathname) || /(?:^|\/)(?:export|download)(?:\/|$|\.)/i.test(target.pathname)) return false;
    if (/\.(?:csv|xlsx?|pdf|zip|json)$/i.test(target.pathname)) return false;
    return target.pathname + target.search !== current.pathname + current.search;
  } catch { return false; }
}

export function shouldStartLinkNavigation(href: string, currentHref: string, event: Click = {}, anchor: Anchor = {}): boolean {
  return !event.defaultPrevented && (event.button === undefined || event.button === 0) &&
    !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
    !anchor.download && !anchor.disabled && (!anchor.target || anchor.target === "_self") &&
    isRouteDestination(href, currentHref);
}
