import { afterEach, describe, expect, it, vi } from "vitest";
import { SB_ROUTE_LOADING_BAR_DONE_EVENT, SB_ROUTE_LOADING_BAR_START_EVENT, triggerRouteLoadingBarDone, triggerRouteLoadingBarStart } from "./loadingBar";

afterEach(() => vi.unstubAllGlobals());

function browser() {
  const events = new EventTarget();
  const start = vi.fn();
  const done = vi.fn();
  events.addEventListener(SB_ROUTE_LOADING_BAR_START_EVENT, start);
  events.addEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, done);
  Object.assign(events, { location: { href: "https://fixture.invalid/playlists?playlist_key=first", origin: "https://fixture.invalid", pathname: "/playlists", search: "?playlist_key=first" } });
  vi.stubGlobal("window", events);
  return { start, done };
}

describe("route feedback signals", () => {
  it("starts immediately for both pathname and search-only navigations", () => {
    const { start } = browser();
    triggerRouteLoadingBarStart("/catalog");
    expect(start).toHaveBeenCalledTimes(1);
    triggerRouteLoadingBarStart("?playlist_key=second");
    expect(start).toHaveBeenCalledTimes(2);
  });
  it("ignores unchanged destinations, hash links, and other origins", () => {
    const { start } = browser();
    for (const href of ["/playlists?playlist_key=first", "#track", "https://other.invalid/catalog"]) triggerRouteLoadingBarStart(href);
    expect(start).not.toHaveBeenCalled();
  });
  it("keeps newer navigation feedback when an older transition is canceled", () => {
    const { done } = browser();
    const first = triggerRouteLoadingBarStart("/catalog");
    const second = triggerRouteLoadingBarStart("/health");
    expect(first).toBeTypeOf("number");
    expect(second).toBeTypeOf("number");
    triggerRouteLoadingBarDone(first);
    expect(done).not.toHaveBeenCalled();
    triggerRouteLoadingBarDone(second);
    expect(done).toHaveBeenCalledTimes(1);
  });
});
