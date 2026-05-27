import { describe, expect, it } from "vitest";

import {
  buildHomeScatterApiUrl,
  buildHomeScatterScopeKey,
  normalizeHomeScatterApiPayload,
} from "./homeScatterApi";

describe("buildHomeScatterScopeKey", () => {
  it("includes dataset mode and competitor label", () => {
    expect(buildHomeScatterScopeKey("own", null)).toBe("own:none");
    expect(buildHomeScatterScopeKey("competitor", "soave")).toBe("competitor:soave");
    expect(buildHomeScatterScopeKey("competitor", "  chill  ")).toBe("competitor:chill");
  });
});

describe("buildHomeScatterApiUrl", () => {
  it("keeps only Home scatter search params and omits blanks", () => {
    expect(
      buildHomeScatterApiUrl({
        scope: "releases",
        range: "90",
        daily: "",
        xy_date: "2026-05-20",
        start: undefined,
        end: "  ",
      }),
    ).toBe("/api/home/scatter?scope=releases&range=90&xy_date=2026-05-20");
  });

  it("returns the bare endpoint when no search params are set", () => {
    expect(buildHomeScatterApiUrl({})).toBe("/api/home/scatter");
  });
});

describe("normalizeHomeScatterApiPayload", () => {
  it("keeps malformed payloads from poisoning client state", () => {
    expect(normalizeHomeScatterApiPayload({ points: "bad", errorMessage: 123, dataDate: null })).toEqual({
      points: [],
      errorMessage: null,
      dataDate: null,
    });
  });
});
