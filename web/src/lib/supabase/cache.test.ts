import { describe, expect, it } from "vitest";

import { cacheTagForKey } from "./cache";

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
