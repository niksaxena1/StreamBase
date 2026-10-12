import { describe, expect, it } from "vitest";
import { Virtualizer } from "@tanstack/react-virtual";
import { buildConcentrationTableRows, CONCENTRATION_TRACK_HEIGHT, CONCENTRATION_DIVIDER_HEIGHT, CONCENTRATION_HEADER_HEIGHT } from "./concentrationTableRows";

describe("concentration virtual rows", () => {
  it("inserts the divider after the threshold without changing track indices", () => {
    expect(buildConcentrationTableRows(4, 1)).toEqual([0, 1, null, 2, 3]);
    expect(buildConcentrationTableRows(3, 0)).toEqual([0, null, 1, 2]);
  });
  it("omits the divider for empty, unreached, or all-track thresholds", () => {
    expect(buildConcentrationTableRows(0, -1)).toEqual([]);
    expect(buildConcentrationTableRows(3, -1)).toEqual([0, 1, 2]);
    expect(buildConcentrationTableRows(3, 2)).toEqual([0, 1, 2]);
  });
  it("windows a full catalog and can reach its last track, accounting for the header and divider", () => {
    const rows = buildConcentrationTableRows(3190, 934);
    const virtualizer = new Virtualizer({
      count: rows.length, getScrollElement: () => null,
      estimateSize: (index) => rows[index] === null ? CONCENTRATION_DIVIDER_HEIGHT : CONCENTRATION_TRACK_HEIGHT,
      paddingStart: CONCENTRATION_HEADER_HEIGHT, overscan: 8,
      initialRect: { width: 390, height: 600 },
      scrollToFn: () => {}, observeElementRect: () => {}, observeElementOffset: () => {},
    });
    expect(virtualizer.getVirtualItems().length).toBeLessThan(35);
    expect(virtualizer.getVirtualItems()[0].index).toBe(0);
    expect(virtualizer.getTotalSize()).toBe(3190 * 48 + 16 + 32);
    virtualizer.scrollOffset = virtualizer.getTotalSize() - 600;
    const lastWindow = virtualizer.getVirtualItems();
    expect(lastWindow.length).toBeLessThan(35);
    expect(rows[lastWindow.at(-1)!.index]).toBe(3189);
  });
});
