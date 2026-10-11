import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CappedDailyPoint, DailyRangeToggle } from "./DailyRangeControls";
import { formatKmbTick } from "./chartUtils";

describe("daily range controls", () => {
  it("renders normal header controls with 32px hit targets", () => {
    const markup = renderToStaticMarkup(createElement(DailyRangeToggle, { typical: false, setRange: vi.fn() }));
    expect(markup).toContain("text-xs");
    expect(markup.match(/min-h-8/g)).toHaveLength(2);
    expect(markup).not.toContain("absolute");
    expect(markup).toContain('aria-pressed="true"');
  });
  it("uses the chart's formatted value in the label and accessible description", () => {
    const formattedValue = formatKmbTick(-15_000_000);
    const markup = renderToStaticMarkup(createElement(CappedDailyPoint, {
      cx: 100, cy: 200, formattedValue, edge: "low", color: "red", index: 1, count: 30, showLabel: true,
    }));
    expect(markup).toContain(`aria-label="Clipped value: ${formattedValue}"`);
    expect(markup).toContain(`>${formattedValue}</text>`);
  });
  it("keeps caps accessible when the adjacent-run label is suppressed", () => {
    const markup = renderToStaticMarkup(createElement(CappedDailyPoint, {
      cx: 100, cy: 200, formattedValue: "12M", edge: "high", color: "green", index: 2, count: 30, showLabel: false,
    }));
    expect(markup).toContain("<path");
    expect(markup).not.toContain("<text");
    expect(markup).toContain('aria-label="Clipped value: 12M"');
  });
});
