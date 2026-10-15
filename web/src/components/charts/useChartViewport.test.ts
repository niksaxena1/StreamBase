import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildAdaptiveSeries, windowForBucket } from "./aggregateSeries";
import { useChartViewport } from "./useChartViewport";

// Exercise the hook's state transitions without a browser or a second React renderer.
const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (next: unknown) => {
      state.values[index] = typeof next === "function" ? next(state.values[index]) : next;
    }];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));

function ViewportTest() {
  return useChartViewport("touch-zoom-test");
}

function render() {
  state.cursor = 0;
  return ViewportTest();
}

beforeEach(() => { state.values = []; });

describe("pinned bucket drill-down", () => {
  it.each(["weekly", "monthly"] as const)("shows daily detail after drilling an explicit %s bucket", (mode) => {
    let view = render();
    view.setMode(mode);
    view = render();
    const bounds = { start: "2024-02-01", end: "2024-04-30" };
    const bucket = windowForBucket("2024-03-04", mode, bounds);
    // Both chart tooltip actions and desktop bucket clicks use this same transition.
    view.zoomTo(bucket, "Selected bucket", mode);
    view = render();
    expect(view.window).toEqual(bucket);
    expect(view.mode).toBe("daily");
    for (const isCumulative of [true, false]) {
      expect(buildAdaptiveSeries({ rowsDesc: [
        { date: "2024-04-30", value: 100 }, { date: "2024-02-01", value: 1 },
      ], valueKey: "value", isCumulative, window: view.window, mode: view.mode }).granularity).toBe("daily");
    }
    view.back();
    view = render();
    expect(view.window).toBeNull();
    expect(view.mode).toBe(mode);
  });

  it("lets the toolbar change detail granularity and reset to the original overview", () => {
    let view = render();
    view.setMode("monthly");
    view = render();
    view.zoomTo({ start: "2024-03-01", end: "2024-03-31" }, "March", "monthly");
    view = render();
    view.setMode("weekly");
    view = render();
    expect(view.mode).toBe("weekly");
    view.reset();
    expect(render().mode).toBe("monthly");
  });

  it("keeps daily detail when a drilled bucket is zoomed further by dragging", () => {
    let view = render();
    view.setMode("monthly");
    view = render();
    view.zoomTo({ start: "2024-03-01", end: "2024-03-31" }, "March", "monthly");
    view = render();
    view.zoomTo({ start: "2024-03-10", end: "2024-03-15" });
    expect(render().mode).toBe("daily");
  });
});
