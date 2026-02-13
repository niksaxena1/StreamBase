import { describe, it, expect } from "vitest";
import { rollbackDataDateToRunDate, capRunDate } from "./rollback";

// Note: getRollbackDate is async and reads cookies (server-side only),
// so we only test the pure helper functions here.

// ---------------------------------------------------------------------------
// rollbackDataDateToRunDate
// ---------------------------------------------------------------------------

describe("rollbackDataDateToRunDate", () => {
  it("adds SOT_DATA_LAG_DAYS (2) to data date", () => {
    expect(rollbackDataDateToRunDate("2026-02-10")).toBe("2026-02-12");
    expect(rollbackDataDateToRunDate("2026-01-01")).toBe("2026-01-03");
  });

  it("handles month boundary", () => {
    expect(rollbackDataDateToRunDate("2026-01-30")).toBe("2026-02-01");
  });

  it("handles year boundary", () => {
    expect(rollbackDataDateToRunDate("2025-12-30")).toBe("2026-01-01");
  });
});

// ---------------------------------------------------------------------------
// capRunDate
// ---------------------------------------------------------------------------

describe("capRunDate", () => {
  it("returns rollback run date when earlier than latest", () => {
    // rollback data date 2026-02-05 → run date 2026-02-07
    // latest run date 2026-02-13 → rollback is earlier, so cap at rollback
    expect(capRunDate("2026-02-13", "2026-02-05")).toBe("2026-02-07");
  });

  it("returns latest run date when rollback is later", () => {
    // rollback data date 2026-02-20 → run date 2026-02-22
    // latest run date 2026-02-13 → rollback is later, so keep latest
    expect(capRunDate("2026-02-13", "2026-02-20")).toBe("2026-02-13");
  });

  it("returns latest when rollback is null", () => {
    expect(capRunDate("2026-02-13", null)).toBe("2026-02-13");
  });

  it("returns null when latest is null", () => {
    expect(capRunDate(null, "2026-02-05")).toBeNull();
  });

  it("returns null when both are null", () => {
    expect(capRunDate(null, null)).toBeNull();
  });
});
