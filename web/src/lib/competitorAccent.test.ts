import { describe, expect, it } from "vitest";

import { accentTextColor, competitorAccentCssVars, relativeLuminanceFromHex } from "./competitorAccent";

describe("competitorAccentCssVars", () => {
  it("returns CSS overrides for valid hex", () => {
    const vars = competitorAccentCssVars("fc6244");
    expect(vars).toContain("--sb-accent:#fc6244");
    expect(vars).toContain("--sb-accent-10:rgba(252,98,68,0.1)");
    expect(vars).toContain("--sb-accent-text:");
  });

  it("returns empty string for invalid hex", () => {
    expect(competitorAccentCssVars("not-a-color")).toBe("");
  });
});

describe("accentTextColor", () => {
  it("returns black on light accents", () => {
    expect(accentTextColor("c7f33c")).toBe("#000");
  });

  it("returns white on dark accents", () => {
    expect(accentTextColor("0c2060")).toBe("#fff");
  });
});

describe("relativeLuminanceFromHex", () => {
  it("returns a value between 0 and 1", () => {
    const y = relativeLuminanceFromHex("808080");
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(1);
  });
});
