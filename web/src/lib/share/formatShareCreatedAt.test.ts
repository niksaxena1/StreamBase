import { describe, expect, it } from "vitest";
import { formatShareSnapshotCreatedAt } from "./formatShareCreatedAt";

describe("formatShareSnapshotCreatedAt", () => {
  it("shows the UTC display format", () => {
    expect(formatShareSnapshotCreatedAt("2026-11-06T20:00:00Z")).toBe("06 Nov 2026, 20:00 UTC");
  });
  it("returns unparseable input unchanged", () => {
    expect(formatShareSnapshotCreatedAt("not a date")).toBe("not a date");
  });
});
