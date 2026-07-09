import { describe, expect, it } from "vitest";

import {
  buildHomeDiagnosticsApiUrl,
  buildHomeDiagnosticsScopeKey,
  normalizeHomeDiagnosticsApiPayload,
} from "./homeDiagnosticsApi";

describe("buildHomeDiagnosticsScopeKey", () => {
  it("includes dataset mode and competitor label", () => {
    expect(buildHomeDiagnosticsScopeKey("own", null)).toBe("own:none");
    expect(buildHomeDiagnosticsScopeKey("competitor", "soave")).toBe("competitor:soave");
    expect(buildHomeDiagnosticsScopeKey("competitor", "  chill  ")).toBe("competitor:chill");
  });
});

describe("buildHomeDiagnosticsApiUrl", () => {
  it("keeps only Home diagnostics search params and omits blanks", () => {
    expect(
      buildHomeDiagnosticsApiUrl({
        scope: "releases",
        range: "90",
        daily: "",
        xy_date: "2026-05-20",
        start: undefined,
        end: "  ",
      }),
    ).toBe("/api/home/diagnostics?scope=releases&range=90&xy_date=2026-05-20");
  });

  it("returns the bare endpoint when no search params are set", () => {
    expect(buildHomeDiagnosticsApiUrl({})).toBe("/api/home/diagnostics");
  });
});

describe("normalizeHomeDiagnosticsApiPayload", () => {
  it("keeps malformed payloads from poisoning client state", () => {
    expect(
      normalizeHomeDiagnosticsApiPayload({
        artistWeekendDips: "bad",
        trackWeekendDips: null,
        negativeDailyStreams: {},
        artificialStreamSpikes: [],
      }),
    ).toEqual({
      artistWeekendDips: [],
      trackWeekendDips: [],
      negativeDailyStreams: [],
      artificialStreamSpikes: [],
      errorMessage: null,
    });
  });
});
