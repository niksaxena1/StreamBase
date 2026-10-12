import { describe, expect, it } from "vitest";

import { fetchAllPages, type PageResult } from "./paging";

function source(total: number) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number): Promise<PageResult<number>> => {
    calls.push([from, to]);
    const data: number[] = [];
    for (let i = from; i <= to && i < total; i++) data.push(i);
    return { data, error: null };
  };
  return { calls, fetchPage };
}

describe("fetchAllPages", () => {
  it("keeps going until a page comes back short", async () => {
    const { calls, fetchPage } = source(2366);
    const rows = await fetchAllPages(fetchPage);
    expect(rows).toHaveLength(2366);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(2365);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks for one more page when the total is an exact multiple", async () => {
    const { calls, fetchPage } = source(2000);
    const rows = await fetchAllPages(fetchPage);
    expect(rows).toHaveLength(2000);
    expect(calls).toHaveLength(3);
  });

  it("handles an empty table and a single short page", async () => {
    expect(await fetchAllPages(source(0).fetchPage)).toEqual([]);
    const small = source(5);
    expect(await fetchAllPages(small.fetchPage)).toHaveLength(5);
    expect(small.calls).toHaveLength(1);
  });

  it("treats null data as an empty page", async () => {
    expect(await fetchAllPages(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it("throws the database error", async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: { message: "permission denied" } }))).rejects.toThrow(
      "permission denied",
    );
  });

  it("supports a custom page size", async () => {
    const { calls, fetchPage } = source(25);
    const rows = await fetchAllPages(fetchPage, 10);
    expect(rows).toHaveLength(25);
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });
});
