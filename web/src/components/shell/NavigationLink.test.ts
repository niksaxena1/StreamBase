import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationLink } from "./NavigationLink";
import RouteLink from "./RouteLink";

const fixture = vi.hoisted(() => ({ prefetch: vi.fn(), start: vi.fn(), effects: [] as Array<() => unknown> }));
vi.mock("react", () => ({
  useEffect: (fn: () => unknown) => fixture.effects.push(fn),
  useState: () => [null, vi.fn()], useRef: () => ({ current: undefined }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/catalog", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ prefetch: fixture.prefetch }) }));
vi.mock("next/link", () => ({ default: "next-link", useLinkStatus: () => ({ pending: false }) }));
vi.mock("@/lib/navigation/loadingBar", () => ({ SB_ROUTE_LOADING_BAR_DONE_EVENT: "done", triggerRouteLoadingBarStart: fixture.start, triggerRouteLoadingBarDone: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks(); fixture.effects.length = 0;
  vi.stubGlobal("window", { location: { href: "https://fixture.invalid/catalog" }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
describe("intent navigation links", () => {
  it("does not prefetch on mount or rerender, only fresh hover or focus events", () => {
    const link = NavigationLink({ href: "/playlists?playlist_key=all_catalog", children: "Playlists" });
    fixture.effects.forEach((effect) => effect());
    expect(link.props.prefetch).toBe(false);
    expect(fixture.prefetch).not.toHaveBeenCalled();
    link.props.onPointerEnter({ defaultPrevented: false });
    expect(fixture.prefetch).toHaveBeenCalledExactlyOnceWith("/playlists?playlist_key=all_catalog");
    NavigationLink({ href: "/playlists?playlist_key=all_catalog", children: "Playlists" });
    expect(fixture.prefetch).toHaveBeenCalledOnce();
    link.props.onFocus({ defaultPrevented: false });
    expect(fixture.prefetch).toHaveBeenCalledTimes(2);
  });
  it("never prefetches the current URL", () => {
    const link = NavigationLink({ href: "/catalog", children: "Catalog" });
    link.props.onPointerEnter({ defaultPrevented: false });
    link.props.onFocus({ defaultPrevented: false });
    expect(fixture.prefetch).not.toHaveBeenCalled();
  });
  it("honors an onNavigate cancellation before starting feedback", () => {
    const preventDefault = vi.fn();
    const link = RouteLink({ href: "/playlists", onNavigate: (event) => event.preventDefault() });
    link.props.onNavigate({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fixture.start).not.toHaveBeenCalled();
  });
  it("composes navigation-link cancellation and skips API/download anchors", () => {
    const nav = NavigationLink({ href: "/playlists", onNavigate: (event) => event.preventDefault() });
    RouteLink(nav.props).props.onNavigate({ preventDefault: vi.fn() });
    for (const props of [{ href: "/api/export" }, { href: "/playlists", download: "tracks.csv" }]) {
      RouteLink(props).props.onNavigate({ preventDefault: vi.fn() });
    }
    expect(fixture.start).not.toHaveBeenCalled();
  });
  it("starts only when Next actually invokes navigation", () => {
    const link = RouteLink({ href: "/playlists" });
    expect(fixture.start).not.toHaveBeenCalled();
    link.props.onNavigate({ preventDefault: vi.fn() });
    expect(fixture.start).toHaveBeenCalledExactlyOnceWith("/playlists");
  });
});
