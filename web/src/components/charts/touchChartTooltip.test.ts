import { describe, expect, it } from "vitest";
import { hitTestChartPoint } from "./useTouchChartTooltip";

describe("touch chart hit testing", () => {
  const points = [{ index: 0, x: 50, y: 80 }, { index: 1, x: 65, y: 85 }];
  it("pins the closest point inside a finger-sized target", () => {
    expect(hitTestChartPoint(points, 62, 82)?.index).toBe(1);
    expect(hitTestChartPoint(points, 35, 80)?.index).toBe(0);
  });
  it("dismisses on empty chart space, including an empty series", () => {
    expect(hitTestChartPoint(points, 50, 150)).toBeNull();
    expect(hitTestChartPoint([], 50, 80)).toBeNull();
  });
});
