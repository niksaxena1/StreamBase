import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleVisibleHomePrefetch } from "./homeSectionPrefetch";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Home background loading", () => {
  it("waits about 1500ms without requestIdleCallback and cleans up on unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const load = vi.fn();
    scheduleVisibleHomePrefetch([load], 1450);
    vi.advanceTimersByTime(1499);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledOnce();
    const cancel = scheduleVisibleHomePrefetch([load], 1450);
    cancel();
    vi.runAllTimers();
    expect(load).toHaveBeenCalledOnce();
  });

  it("lets the rest of Home paint, then waits for browser idle time", () => {
    vi.useFakeTimers();
    let idleCallback!: () => void;
    const requestIdleCallback = vi.fn((callback: () => void) => { idleCallback = callback; return 1; });
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("window", { setTimeout, clearTimeout, requestIdleCallback, cancelIdleCallback });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const load = vi.fn();
    const cancel = scheduleVisibleHomePrefetch([load], 1450);
    vi.advanceTimersByTime(1449);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestIdleCallback).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    idleCallback();
    expect(load).toHaveBeenCalledOnce();
    cancel();
  });
});
