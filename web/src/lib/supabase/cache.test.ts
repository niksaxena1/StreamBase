import { beforeEach, describe, expect, it, vi } from "vitest";

const nextCacheMock = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <T>(queryFn: () => Promise<T>, keyParts: string[]) =>
    async () => {
      const key = JSON.stringify(keyParts);
      if (nextCacheMock.values.has(key)) return nextCacheMock.values.get(key) as T;
      const value = await queryFn();
      nextCacheMock.values.set(key, value);
      return value;
    },
}));

import { cachedQuery, cacheTagForKey, scopedAnalyticsCacheKey } from "./cache";

beforeEach(() => {
  nextCacheMock.values.clear();
});

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

describe("cachedQuery", () => {
  it("retries a statement timeout once and caches the successful result", async () => {
    const queryFn = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "57014", message: "canceling statement due to statement timeout" },
      })
      .mockResolvedValueOnce({ data: ["ok"], error: null });

    await expect(cachedQuery(queryFn, "timeout-then-success")).resolves.toEqual({
      data: ["ok"],
      error: null,
    });
    await expect(cachedQuery(queryFn, "timeout-then-success")).resolves.toEqual({
      data: ["ok"],
      error: null,
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed query results", async () => {
    const failedQuery = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "temporary database failure" },
    });
    const successfulQuery = vi.fn().mockResolvedValue({ data: ["recovered"], error: null });

    await expect(cachedQuery(failedQuery, "failure-is-not-cached")).resolves.toEqual({
      data: null,
      error: { code: "XX000", message: "temporary database failure" },
    });
    await expect(cachedQuery(successfulQuery, "failure-is-not-cached")).resolves.toEqual({
      data: ["recovered"],
      error: null,
    });
    expect(failedQuery).toHaveBeenCalledTimes(1);
    expect(successfulQuery).toHaveBeenCalledTimes(1);
  });

  it("returns a timeout error after one failed retry without caching it", async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    await expect(cachedQuery(queryFn, "repeated-timeout")).resolves.toEqual({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});
