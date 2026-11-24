import { describe, expect, it } from "vitest";
import { lastStreamGainRunDate } from "./catalogPageUtils";

const row = (date: string, streams_cumulative: number | null) => ({ date, streams_cumulative });

describe("lastStreamGainRunDate", () => {
  it("returns the first day the frozen total was reached, ignoring a later drop to 0", () => {
    expect(
      lastStreamGainRunDate([
        row("2026-10-02", 0),
        row("2024-12-17", 176183),
        row("2024-12-18", 176184),
        row("2025-06-01", 176184),
        row("2026-10-01", 0),
      ]),
    ).toBe("2024-12-18");
  });

  it("returns null while the track still gains on the latest day", () => {
    expect(lastStreamGainRunDate([row("2026-11-01", 10), row("2026-11-02", 12)])).toBeNull();
  });

  it("returns null for no streams or no rows", () => {
    expect(lastStreamGainRunDate([row("2026-11-01", 0), row("2026-11-02", null)])).toBeNull();
    expect(lastStreamGainRunDate([])).toBeNull();
  });
});
