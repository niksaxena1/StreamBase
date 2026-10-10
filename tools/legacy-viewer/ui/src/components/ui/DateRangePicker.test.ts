import { describe, expect, it } from "vitest";
import { archivePresets } from "./DateRangePicker";
describe("archive-relative ranges", () => {
  it("anchors trailing windows to the archive end and clips calendar years", () => {
    const presets = archivePresets({ from: "2023-07-08", to: "2025-12-22" });
    expect(presets.find((p) => p.label === "2023")?.range).toEqual({
      from: "2023-07-08",
      to: "2023-12-31",
    });
    expect(presets.find((p) => p.label === "2025")?.range.to).toBe(
      "2025-12-22",
    );
    expect(presets.find((p) => p.label.startsWith("Last 30"))?.range).toEqual({
      from: "2025-11-23",
      to: "2025-12-22",
    });
  });
  it("clips trailing ranges to short archives", () => {
    const presets = archivePresets({ from: "2024-03-05", to: "2024-03-10" });
    expect(
      presets.find((p) => p.label.startsWith("Last 365"))?.range.from,
    ).toBe("2024-03-05");
  });
});
