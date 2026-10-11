import { afterEach, describe, expect, it, vi } from "vitest";
import { createHomeRequestCache, homePrefetchKey, scheduleHomePrefetch, scheduleVisibleHomePrefetch } from "./homeSectionPrefetch";

function environment(visibleInitially = true) {
  let visible = visibleInitially;
  let listener: (() => void) | undefined;
  const idle = vi.fn((callback: () => void) => {
    const id = setTimeout(callback, 10);
    return () => clearTimeout(id);
  });
  return {
    env: {
      isVisible: () => visible,
      idle,
      delay: (callback: () => void, ms: number) => {
        const id = setTimeout(callback, ms);
        return () => clearTimeout(id);
      },
      onVisibilityChange: (callback: () => void) => {
        listener = callback;
        return () => { listener = undefined; };
      },
    },
    setVisible(value: boolean) { visible = value; listener?.(); },
    // Simulate visibility changing between a timer firing and its event arriving.
    hideWithoutEvent() { visible = false; },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("scheduleHomePrefetch", () => {
  it("waits for the primary-content grace period, then idles and staggers", () => {
    vi.useFakeTimers();
    const first = vi.fn(), second = vi.fn();
    const { env } = environment();
    scheduleHomePrefetch([first, second], env);
    vi.advanceTimersByTime(1799);
    expect(first).not.toHaveBeenCalled();
    expect(env.idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(260);
    expect(second).toHaveBeenCalledOnce();
  });
  it("does no hidden-tab work and resumes once visible", () => {
    vi.useFakeTimers();
    const task = vi.fn();
    const state = environment(false);
    scheduleHomePrefetch([task], state.env);
    vi.advanceTimersByTime(10_000);
    expect(state.env.idle).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
    state.setVisible(true);
    vi.advanceTimersByTime(260);
    expect(task).toHaveBeenCalledOnce();
    state.setVisible(false);
    state.setVisible(true);
    vi.runAllTimers();
    expect(task).toHaveBeenCalledOnce();
  });
  it("checks visibility again inside the idle callback", () => {
    vi.useFakeTimers();
    const task = vi.fn();
    const state = environment();
    scheduleHomePrefetch([task], state.env);
    vi.advanceTimersByTime(1800);
    state.hideWithoutEvent();
    vi.advanceTimersByTime(10);
    expect(task).not.toHaveBeenCalled();
    state.setVisible(true);
    vi.advanceTimersByTime(260);
    expect(task).toHaveBeenCalledOnce();
  });
  it("cancels pending work on cleanup or hide", () => {
    vi.useFakeTimers();
    const task = vi.fn();
    const state = environment();
    const cancel = scheduleHomePrefetch([task], state.env);
    vi.advanceTimersByTime(1800);
    state.setVisible(false);
    vi.runAllTimers();
    expect(task).not.toHaveBeenCalled();
    state.setVisible(true);
    cancel();
    vi.runAllTimers();
    expect(task).not.toHaveBeenCalled();
  });
  it("shares a request when opening during prefetch and reuses its result", async () => {
    vi.useFakeTimers();
    const cache = createHomeRequestCache();
    const key = homePrefetchKey("competitor", "soave", "2026-10-11", "/api/home/scatter");
    let finish!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    let warm!: Promise<string>;
    scheduleHomePrefetch([() => { warm = cache.get(key, load); }], environment().env);
    await vi.advanceTimersByTimeAsync(1810);
    const opened = cache.get(key, load);
    expect(opened).toBe(warm);
    expect(load).toHaveBeenCalledOnce();
    finish("ready");
    await expect(opened).resolves.toBe("ready");
    await expect(cache.get(key, load)).resolves.toBe("ready");
    expect(load).toHaveBeenCalledOnce();
  });
  it("also deduplicates an open request that starts before idle prefetch", async () => {
    vi.useFakeTimers();
    const cache = createHomeRequestCache();
    const load = vi.fn(async () => "ready");
    const opened = cache.get("scope", load);
    scheduleHomePrefetch([() => { void cache.get("scope", load); }], environment().env);
    await vi.advanceTimersByTimeAsync(1810);
    await expect(opened).resolves.toBe("ready");
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("home request cache scoping", () => {
  it("treats errorMessage responses as failures, evicts them, and retries", async () => {
    const cache = createHomeRequestCache();
    const load = vi.fn()
      .mockResolvedValueOnce({ points: [], errorMessage: "RPC failed" })
      .mockResolvedValueOnce({ points: ["ready"], errorMessage: null });
    const warm = cache.get("scatter", load);
    expect(cache.get("scatter", load)).toBe(warm);
    await expect(warm).rejects.toThrow("RPC failed");
    const ready = cache.get("scatter", load);
    await expect(ready).resolves.toEqual({ points: ["ready"], errorMessage: null });
    expect(cache.get("scatter", load)).toBe(ready);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("separates mode, label, snapshot and URL", async () => {
    const cache = createHomeRequestCache();
    const load = vi.fn(async () => "data");
    const keys = [
      homePrefetchKey("own", null, "d1", "/api/home/scatter"),
      homePrefetchKey("competitor", null, "d1", "/api/home/scatter"),
      homePrefetchKey("competitor", "soave", "d1", "/api/home/scatter"),
      homePrefetchKey("competitor", "chill", "d1", "/api/home/scatter"),
      homePrefetchKey("competitor", "chill", "d2", "/api/home/scatter"),
      homePrefetchKey("competitor", "chill", "d2", "/api/home/scatter?range=90"),
    ];
    await Promise.all(keys.map((key) => cache.get(key, load)));
    expect(new Set(keys).size).toBe(6);
    expect(load).toHaveBeenCalledTimes(6);
  });
  it("allows retry after a failed prefetch", async () => {
    const cache = createHomeRequestCache();
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("retried");
    await expect(cache.get("key", load)).rejects.toThrow("offline");
    await expect(cache.get("key", load)).resolves.toBe("retried");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("browser idle prefetch", () => {
  it("uses a 3000ms native idle timeout", () => {
    vi.useFakeTimers();
    const requestIdleCallback = vi.fn((callback: () => void) => setTimeout(callback, 10));
    vi.stubGlobal("window", { requestIdleCallback, cancelIdleCallback: clearTimeout, setTimeout, clearTimeout });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const task = vi.fn();
    const cancel = scheduleVisibleHomePrefetch([task]);
    vi.advanceTimersByTime(1800);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    vi.advanceTimersByTime(10);
    expect(task).toHaveBeenCalledOnce();
    cancel();
  });
});
