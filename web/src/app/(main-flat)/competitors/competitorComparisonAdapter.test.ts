import { describe, expect, it } from "vitest";

import { accentColorDistance } from "@/lib/competitorAccentPalette";
import { applyResolvedLabelAccents } from "@/lib/competitorLabelAccents";

import { buildSeriesColorMap } from "./competitorComparisonAdapter";
import type { LabelRow } from "./competitorsTypes";

function label(key: string, accent: string): LabelRow {
  return {
    label_key: key,
    display_name: key,
    is_active: true,
    accent_hex: accent,
  };
}

describe("buildSeriesColorMap", () => {
  it("uses resolved accents for chart and table series colors", () => {
    const labels = applyResolvedLabelAccents([label("atlast", "fd0280"), label("selected", "db0c0c")]);
    const colors = buildSeriesColorMap(labels);
    expect(colors.atlast).toMatch(/^#/);
    expect(colors.selected).toBe("#db0c0c");
    expect(accentColorDistance(colors.atlast!.slice(1), "db0c0c")).toBeGreaterThanOrEqual(0.33);
  });
});
