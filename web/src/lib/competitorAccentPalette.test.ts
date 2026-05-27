import { describe, expect, it } from "vitest";

import {
  accentColorDistance,
  harmonizeAccentBatch,
  pickDistinctAccent,
  separateAccentFromAssigned,
} from "./competitorAccentPalette";

describe("accentColorDistance", () => {
  it("treats ATLAST and selected. reds as visually close", () => {
    expect(accentColorDistance("fb0436", "db0c0c")).toBeLessThan(0.24);
  });
});

describe("pickDistinctAccent", () => {
  it("nudges a second red toward pink when selected. is already assigned", () => {
    const candidates = ["fb0436", "db0c0c", "ff6688"];
    const picked = pickDistinctAccent(candidates, ["db0c0c"]);
    expect(accentColorDistance(picked, "db0c0c")).toBeGreaterThanOrEqual(0.24);
    const [, s] = (() => {
      const r = parseInt(picked.slice(0, 2), 16);
      const g = parseInt(picked.slice(2, 4), 16);
      const b = parseInt(picked.slice(4, 6), 16);
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const l = (max + min) / 2;
      const d = max - min;
      const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      return [0, sat];
    })();
    expect(s).toBeGreaterThan(0.2);
  });
});

describe("harmonizeAccentBatch", () => {
  it("pushes the lighter red label toward pink when two labels clash", () => {
    const batch = new Map<string, string>([
      ["selected", "db0c0c"],
      ["atlast", "fb0436"],
    ]);
    const out = harmonizeAccentBatch(batch);
    expect(out.get("atlast")).not.toBe("fb0436");
    expect(accentColorDistance(out.get("atlast")!, out.get("selected")!)).toBeGreaterThanOrEqual(0.33);
    expect(out.get("selected")).toBe("db0c0c");
  });

  it("still separates a bright red and a coral that barely pass the global threshold", () => {
    const batch = new Map<string, string>([
      ["selected", "fc7d7d"],
      ["atlast", "fb0436"],
    ]);
    const out = harmonizeAccentBatch(batch);
    expect(out.get("atlast")).not.toBe("fb0436");
    expect(accentColorDistance(out.get("atlast")!, out.get("selected")!)).toBeGreaterThanOrEqual(0.33);
  });
});

describe("separateAccentFromAssigned", () => {
  it("can shift a bright red toward magenta", () => {
    const shifted = separateAccentFromAssigned("fb0436", ["db0c0c"], true);
    expect(shifted).not.toBe("fb0436");
    expect(accentColorDistance(shifted, "db0c0c")).toBeGreaterThanOrEqual(0.24);
  });
});
