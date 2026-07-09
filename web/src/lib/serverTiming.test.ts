import { describe, expect, it } from "vitest";

import { isTimingEnvEnabled, shouldLogServerTiming } from "./serverTiming";

describe("isTimingEnvEnabled", () => {
  it("accepts common truthy strings", () => {
    expect(isTimingEnvEnabled("1")).toBe(true);
    expect(isTimingEnvEnabled("TRUE")).toBe(true);
    expect(isTimingEnvEnabled("yes")).toBe(true);
  });

  it("rejects blank or falsey strings", () => {
    expect(isTimingEnvEnabled("")).toBe(false);
    expect(isTimingEnvEnabled("0")).toBe(false);
    expect(isTimingEnvEnabled("false")).toBe(false);
  });
});

describe("shouldLogServerTiming", () => {
  it("logs only when timing is enabled and the duration reaches the threshold", () => {
    expect(shouldLogServerTiming({ enabled: true, durationMs: 250, thresholdMs: 200 })).toBe(true);
    expect(shouldLogServerTiming({ enabled: true, durationMs: 199, thresholdMs: 200 })).toBe(false);
    expect(shouldLogServerTiming({ enabled: false, durationMs: 500, thresholdMs: 200 })).toBe(false);
  });
});
