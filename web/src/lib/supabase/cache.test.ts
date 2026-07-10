import { describe, expect, it } from "vitest";

import { cacheTagForKey, scopedAnalyticsCacheKey } from "./cache";

describe("cacheTagForKey", () => {
  it("keeps cache tags within Next's length limit", () => {
    const longKey = `home-track-meta-for-overrides-${Array.from({ length: 300 }, (_, i) => `ISRC${i}`).join(",")}`;

    const tag = cacheTagForKey(longKey);

    expect(tag).toMatch(/^supabase-/);
    expect(tag.length).toBeLessThanOrEqual(256);
  });

  it("adds a stable hash suffix so truncated keys remain distinct", () => {
    const prefix = "x".repeat(400);

    expect(cacheTagForKey(`${prefix}-a`)).not.toBe(cacheTagForKey(`${prefix}-b`));
  });
});

describe("scopedAnalyticsCacheKey", () => {
  it("keeps own and competitor analytics in distinct cache universes", () => {
    const own = scopedAnalyticsCacheKey({ feature: "home", datasetMode: "own", snapshotDate: "2026-07-09" });
    const competitor = scopedAnalyticsCacheKey({ feature: "home", datasetMode: "competitor", competitorLabelKey: "label-a", snapshotDate: "2026-07-09" });
    expect(own).not.toBe(competitor);
    expect(competitor).toContain("label:label-a");
  });

  it("rejects unscoped competitor cache keys", () => {
    expect(() => scopedAnalyticsCacheKey({ feature: "home", datasetMode: "competitor" })).toThrow();
  });
});
