import { describe, expect, it } from "vitest";
import { resolveTrackTakedown, takedownNeedsStreamEstimate } from "./catalogPageUtils";

const unavailable = (unavailable_since: string, last_available_at: string | null) => ({
  status: "unavailable",
  unavailable_since,
  last_available_at,
});

describe("resolveTrackTakedown", () => {
  it("uses the detection day when the daily check saw the track go down", () => {
    expect(
      resolveTrackTakedown({
        availability: unavailable("2026-11-06T05:00:00Z", "2026-11-05T05:00:00Z"),
        spotifyNotFoundSince: null,
        lastStreamGainDate: "2026-11-01",
      }),
    ).toEqual({ precision: "detected", date: "2026-11-06T05:00:00Z", lastAvailableAt: "2026-11-05T05:00:00Z" });
  });

  it("estimates from stream history when the track was already down at the first check", () => {
    expect(
      resolveTrackTakedown({
        availability: unavailable("2026-10-11T05:00:00Z", null),
        spotifyNotFoundSince: null,
        lastStreamGainDate: "2025-03-02",
      }),
    ).toEqual({ precision: "estimated", date: "2025-03-02", confirmedMissingSince: "2026-10-11T05:00:00Z" });
  });

  it("estimates for never-matched tracks and falls back to the search-miss date", () => {
    expect(
      resolveTrackTakedown({ availability: null, spotifyNotFoundSince: "2026-10-13", lastStreamGainDate: "2024-12-16" }),
    ).toEqual({ precision: "estimated", date: "2024-12-16", confirmedMissingSince: "2026-10-13" });
    expect(
      resolveTrackTakedown({ availability: null, spotifyNotFoundSince: "2026-10-13", lastStreamGainDate: null }),
    ).toEqual({ precision: "at_least", date: "2026-10-13" });
  });

  it("shows nothing when the check finds the track playable or there is no signal", () => {
    const available = { status: "available", unavailable_since: null, last_available_at: "2026-11-24" };
    expect(resolveTrackTakedown({ availability: available, spotifyNotFoundSince: "2026-10-13", lastStreamGainDate: "2024-01-01" })).toBeNull();
    expect(resolveTrackTakedown({ availability: null, spotifyNotFoundSince: null, lastStreamGainDate: "2024-01-01" })).toBeNull();
  });
});

describe("takedownNeedsStreamEstimate", () => {
  it("only reads history when the date must be estimated", () => {
    expect(takedownNeedsStreamEstimate(unavailable("2026-11-06", "2026-11-05"), null)).toBe(false);
    expect(takedownNeedsStreamEstimate(unavailable("2026-10-11", null), null)).toBe(true);
    expect(takedownNeedsStreamEstimate(null, "2026-10-13")).toBe(true);
    expect(takedownNeedsStreamEstimate({ status: "available", unavailable_since: null, last_available_at: "x" }, "2026-10-13")).toBe(false);
    expect(takedownNeedsStreamEstimate(null, null)).toBe(false);
  });
});
