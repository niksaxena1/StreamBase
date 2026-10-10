import { describe, expect, it } from "vitest";
import { createPageScheduler, fetchOrderedPages } from "./orderedPages";

describe("ordered counted pages", () => {
  for (const count of [0, 3, 4, 8, 27, 40]) {
    it(`matches sequential ranges and rows for ${count} rows`, async () => {
      const source = Array.from({ length: count }, (_, i) => i);
      const offsets: number[] = [];
      let active = 0;
      let peak = 0;
      const result = await fetchOrderedPages({
        pageSize: 4,
        maxRows: 32,
        fetchPage: async (offset, withCount) => {
          offsets.push(offset);
          peak = Math.max(peak, ++active);
          // Finish later ranges first to verify the merge, not arrival order.
          await new Promise((resolve) => setTimeout(resolve, 12 - offset / 4));
          active--;
          return { data: source.slice(offset, offset + 4), count: withCount ? count : null };
        },
      });
      const expectedOffsets = [];
      for (let offset = 0; offset < 32; offset += 4) {
        expectedOffsets.push(offset);
        if (source.slice(offset, offset + 4).length < 4) break;
      }
      expect(offsets).toEqual(expectedOffsets);
      expect(result).toEqual(source.slice(0, 32));
      expect(peak).toBeLessThanOrEqual(4);
      if (count >= 27) expect(peak).toBe(4);
    });
  }

  it("keeps the sequential fallback when count is missing", async () => {
    const source = [0, 1, 2, 3, 4];
    let active = 0;
    let peak = 0;
    const result = await fetchOrderedPages({
      pageSize: 2,
      maxRows: 10,
      fetchPage: async (offset) => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        return { data: source.slice(offset, offset + 2) };
      },
    });
    expect(result).toEqual(source);
    expect(peak).toBe(1);
  });

  it("propagates page failures", async () => {
    await expect(fetchOrderedPages({
      pageSize: 2,
      maxRows: 10,
      fetchPage: async (offset) => {
        if (offset === 4) throw new Error("page failed");
        return { data: [offset, offset + 1], count: 8 };
      },
    })).rejects.toThrow("page failed");
  });

  it("shares the four-page limit across labels", async () => {
    const schedule = createPageScheduler(4);
    let active = 0;
    let peak = 0;
    const source = Array.from({ length: 30 }, (_, i) => i);
    const results = await Promise.all(["a", "b", "c"].map(() => fetchOrderedPages({
      pageSize: 4,
      maxRows: 32,
      fetchPage: (offset) => schedule(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        return { data: source.slice(offset, offset + 4), count: source.length };
      }),
    })));
    expect(peak).toBe(4);
    expect(results).toEqual([source, source, source]);
  });
});
