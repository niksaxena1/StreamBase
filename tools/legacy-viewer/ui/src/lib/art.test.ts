import { describe, expect, it } from "vitest";
import { TILE_TONES, initials, tileTone } from "./art";
import { sparklinePath } from "./sparkline";
import { easeOutCubic, valueAt } from "./animation";

describe("initials tile", () => {
  it("uses the first letters of two words, or two letters of one", () => {
    expect(initials("Lone Tusker")).toBe("LT");
    expect(initials("Joongle")).toBe("JO");
    expect(initials("a")).toBe("A");
    expect(initials("  Victoria   Voss  feat. Sam")).toBe("VV");
  });
  it("skips punctuation and handles accents and non-latin names", () => {
    expect(initials('"XY"')).toBe("XY");
    expect(initials("...Baby One More Time")).toBe("BO");
    expect(initials("Élan Vital")).toBe("ÉV");
    expect(initials("Nøway")).toBe("NØ");
    expect(initials("あいう")).toBe("あい");
  });
  it("falls back to a note for empty or symbol-only names", () => {
    expect(initials("")).toBe("♪");
    expect(initials(null)).toBe("♪");
    expect(initials("!!! ???")).toBe("♪");
  });
  it("gives a stable tone per name", () => {
    expect(tileTone("Joongle")).toBe(tileTone("Joongle"));
    expect(TILE_TONES).toContain(tileTone("Anything"));
    expect(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(tileTone)).size).toBeGreaterThan(1);
  });
});

describe("sparkline path", () => {
  it("breaks the line at missing days instead of drawing zero", () => {
    const { line } = sparklinePath([1, 2, null, 4, 5], 100, 20);
    expect(line.match(/M/g)).toHaveLength(2);
    expect(line).not.toContain(",20");
  });
  it("handles flat, single and empty series", () => {
    expect(sparklinePath([], 100, 20).line).toBe("");
    expect(sparklinePath([null, null], 100, 20).line).toBe("");
    expect(sparklinePath([5, 5, 5], 100, 20).line).toContain("10");
    expect(sparklinePath([3], 100, 20).line).toMatch(/^M50,10/);
  });
  it("fills only the longest run", () => {
    const { area } = sparklinePath([1, null, 2, 3, 4], 100, 20);
    expect(area.startsWith("M")).toBe(true);
    expect(area.endsWith("Z")).toBe(true);
    expect(sparklinePath([1, null, 2], 100, 20).area).toBe("");
  });
});

describe("counter animation", () => {
  it("eases out and lands exactly on the value", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(valueAt(0, 923, 0)).toBe(0);
    expect(valueAt(0, 923, 1)).toBe(923);
    expect(valueAt(0, 923, 1.4)).toBe(923);
    const mid = valueAt(0, 1000, 0.5);
    expect(mid).toBeGreaterThan(500);
    expect(mid).toBeLessThan(1000);
    expect(valueAt(500, -100, 1)).toBe(-100);
  });
});
