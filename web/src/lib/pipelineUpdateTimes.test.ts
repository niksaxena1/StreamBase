import { describe, expect, it } from "vitest";
import { pipelineUpdateTooltip } from "./pipelineUpdateTimes";

describe("pipelineUpdateTooltip", () => {
  it("selects the own catalog schedule", () => {
    expect(pipelineUpdateTooltip("own")).toBe("Next update starts 09:07 GMT+4 (daily, automatic). New data usually appears by ~10:00.");
  });
  it("selects the competitor schedule", () => {
    expect(pipelineUpdateTooltip("competitor")).toBe("Next update starts 09:23 GMT+4 (daily, automatic). New data usually appears by ~10:15.");
  });
});
