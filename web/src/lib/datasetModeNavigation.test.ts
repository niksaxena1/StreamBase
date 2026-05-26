import { describe, expect, it } from "vitest";

import {
  pathAfterDatasetModeSwitch,
  shouldStripUniverseQueryOnModeSwitch,
  stripUniverseSearchParams,
} from "@/lib/datasetModeNavigation";

describe("stripUniverseSearchParams", () => {
  it("removes universe-scoped params", () => {
    expect(
      stripUniverseSearchParams("?playlist_key=all_catalog&artist_id=abc&foo=1"),
    ).toBe("?foo=1");
  });

  it("returns empty when only universe params were present", () => {
    expect(stripUniverseSearchParams("?artist_id=x&isrc=y")).toBe("");
  });

  it("strips home scatter params", () => {
    expect(stripUniverseSearchParams("?xy_date=2026-05-01&scope=releases")).toBe("");
  });

  it("strips health date param", () => {
    expect(stripUniverseSearchParams("?date=2026-05-12")).toBe("");
  });
});

describe("pathAfterDatasetModeSwitch", () => {
  it("cleans home, playlists, catalog, and health", () => {
    expect(pathAfterDatasetModeSwitch("/", "?xy_date=2026-05-01")).toBe("/");
    expect(pathAfterDatasetModeSwitch("/playlists", "?playlist_key=x")).toBe("/playlists");
    expect(pathAfterDatasetModeSwitch("/catalog", "?artist_id=a&isrc=b")).toBe("/catalog");
    expect(pathAfterDatasetModeSwitch("/health", "?date=2026-05-12")).toBe("/health");
  });

  it("preserves unrelated query params", () => {
    expect(pathAfterDatasetModeSwitch("/catalog", "?artist_id=a&keep=1")).toBe("/catalog?keep=1");
  });

  it("returns null for routes that should full-reload", () => {
    expect(pathAfterDatasetModeSwitch("/competitors", "?x=1")).toBeNull();
    expect(pathAfterDatasetModeSwitch("/settings")).toBeNull();
  });
});

describe("shouldStripUniverseQueryOnModeSwitch", () => {
  it("matches the allowlist", () => {
    expect(shouldStripUniverseQueryOnModeSwitch("/")).toBe(true);
    expect(shouldStripUniverseQueryOnModeSwitch("/collectors")).toBe(false);
  });
});
