import { describe, expect, it } from "vitest";

import { normalizeDatasetMode } from "@/lib/datasetMode";

describe("normalizeDatasetMode", () => {
  it("returns competitor for competitor", () => {
    expect(normalizeDatasetMode("competitor")).toBe("competitor");
  });

  it("falls back to own for anything else", () => {
    expect(normalizeDatasetMode(undefined)).toBe("own");
    expect(normalizeDatasetMode("garbage")).toBe("own");
  });
});
