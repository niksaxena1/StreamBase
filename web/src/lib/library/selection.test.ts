import { describe, expect, it } from "vitest";

import { pruneSelection, toggleAllInSelection, toggleInSelection, type SelectionState } from "./selection";

const ids = ["a", "b", "c", "d", "e"];
const empty: SelectionState = { selected: new Set(), anchor: null };

describe("toggleInSelection", () => {
  it("selects and deselects one row and remembers the anchor", () => {
    const one = toggleInSelection(empty, ids, 1, false);
    expect([...one.selected]).toEqual(["b"]);
    expect(one.anchor).toBe(1);
    const none = toggleInSelection(one, ids, 1, false);
    expect(none.selected.size).toBe(0);
  });

  it("shift-click selects the range from the anchor, in either direction", () => {
    const start = toggleInSelection(empty, ids, 1, false);
    expect([...toggleInSelection(start, ids, 3, true).selected].sort()).toEqual(["b", "c", "d"]);
    expect([...toggleInSelection(toggleInSelection(empty, ids, 3, false), ids, 1, true).selected].sort()).toEqual(["b", "c", "d"]);
  });

  it("shift-click on a selected row deselects the range", () => {
    const all = toggleAllInSelection(empty, ids);
    const next = toggleInSelection({ ...all, anchor: 0 }, ids, 2, true);
    expect([...next.selected].sort()).toEqual(["d", "e"]);
  });

  it("shift-click with no anchor acts like a plain click", () => {
    expect([...toggleInSelection(empty, ids, 2, true).selected]).toEqual(["c"]);
  });

  it("ignores an index outside the list", () => {
    expect(toggleInSelection(empty, ids, 9, false)).toBe(empty);
  });
});

describe("toggleAllInSelection", () => {
  it("selects every visible row, then clears when all are selected", () => {
    const all = toggleAllInSelection(empty, ids);
    expect(all.selected.size).toBe(5);
    expect(toggleAllInSelection(all, ids).selected.size).toBe(0);
  });
  it("selects all when only some are selected", () => {
    const some = toggleInSelection(empty, ids, 0, false);
    expect(toggleAllInSelection(some, ids).selected.size).toBe(5);
  });
  it("does nothing useful on an empty list", () => {
    expect(toggleAllInSelection(empty, []).selected.size).toBe(0);
  });
});

describe("pruneSelection", () => {
  it("drops rows that are no longer visible", () => {
    const pruned = pruneSelection(new Set(["a", "b", "z"]), new Set(ids));
    expect([...pruned].sort()).toEqual(["a", "b"]);
  });
  it("returns the same set when nothing changed", () => {
    const selected = new Set(["a"]);
    expect(pruneSelection(selected, new Set(ids))).toBe(selected);
  });
});
