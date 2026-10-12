import { describe, expect, it } from "vitest";
import { createAxisTickFormatter, placeChartLabels, readableLightChartColor } from "./chartUtils";
import { resolveDailyRange } from "./DailyRangeControls";

describe("uniform axis ticks", () => {
  it("uses the largest absolute tick for one unit including small negatives and zero", () => {
    const ticks = [3_200_000, -286_000, -15_300_000, 0];
    expect(ticks.map(createAxisTickFormatter(ticks))).toEqual(["3.2M", "-0.3M", "-15.3M", "0M"]);
  });
  it("limits precision, removes trailing zeros and avoids negative zero", () => {
    const fmt = createAxisTickFormatter([123_456, 1_000]);
    expect([123_456, 10_000, 1_000, -1].map(fmt)).toEqual(["123k", "10k", "1k", "0k"]);
    expect(createAxisTickFormatter([])(0)).toBe("0");
    expect(createAxisTickFormatter([1_000_000_000])(1_000_000_000)).toBe("1B");
  });
  it("selects the unit after currency conversion", () => {
    expect(createAxisTickFormatter([800], 3.6725)(800)).toBe("2.9k");
  });
});

describe("annotation placement", () => {
  const label = (id: string, x: number, y: number, priority: number) => ({ id, x, y, priority, text: `${priority}%` });
  it("keeps the larger magnitude when labels overlap regardless of input order", () => {
    expect(placeChartLabels([label("small", 100, 20, -20), label("large", 105, 20, -24)]).map(l => l.id)).toEqual(["large"]);
  });
  it("allows labels in separate rows and limits phones to the four largest", () => {
    const labels = Array.from({ length: 6 }, (_, i) => label(String(i), i * 50, 20, i + 1));
    expect(placeChartLabels(labels, 4).map(l => l.id)).toEqual(["5", "4", "3", "2"]);
    expect(placeChartLabels([label("a", 100, 20, 20), label("b", 100, 50, 24)])).toHaveLength(2);
  });
});

describe("daily range defaults", () => {
  it("defaults phones to typical and desktop to full", () => {
    expect(resolveDailyRange(null, true)).toBe("typical");
    expect(resolveDailyRange(null, false)).toBe("full");
  });
  it("honors both persisted choices before the viewport default", () => {
    expect(resolveDailyRange("full", true)).toBe("full");
    expect(resolveDailyRange("typical", false)).toBe("typical");
  });
  it("keeps the latest session choice if storage retains an older choice", () => {
    expect(resolveDailyRange("full", false, "typical")).toBe("typical");
  });
});

describe("custom light chart accents", () => {
  it("retains passing colors and darkens a bright competitor accent", () => {
    expect(readableLightChartColor("#4d7c0f", "#f0f0f0")).toBe("#4d7c0f");
    expect(readableLightChartColor("#c7f33c", "#f0f0f0")).not.toBe("#c7f33c");
  });
});
