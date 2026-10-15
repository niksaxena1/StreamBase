import { describe, expect, it } from "vitest";
import { pipelineUpdateTooltip } from "./pipelineUpdateTimes";

describe("pipelineUpdateTooltip", () => {
  it("selects the own catalog schedule", () => {
    expect(pipelineUpdateTooltip("own")).toBe("Next update starts 16:00 GMT+4 (daily, automatic).");
  });
  it("selects the competitor schedule", () => {
    expect(pipelineUpdateTooltip("competitor")).toBe("Next update starts 16:16 GMT+4 (daily, automatic).");
  });
});
