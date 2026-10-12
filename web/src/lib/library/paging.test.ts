import { describe, expect, it } from "vitest";

import { fetchAllByKeyset, fetchAllPages, type PageResult } from "./paging";

/** A sorted table of IDs that tests can change between page reads. */
function table(ids: string[]) {
  const data = [...ids];
  return {
    data,
    insert(id: string) {
      data.push(id);
      data.sort();
    },
    offsetPage: async (from: number, to: number): Promise<PageResult<string>> => ({
      data: data.slice(from, to + 1),
      error: null,
    }),
    keysetPage: async (after: string | null, limit: number): Promise<PageResult<string>> => ({
      data: data.filter((id) => after === null || id > after).slice(0, limit),
      error: null,
    }),
  };
}

const idList = (n: number) => Array.from({ length: n }, (_, i) => `TG-${String(i * 2).padStart(5, "0")}`);

describe("fetchAllByKeyset", () => {
  it("reads every row, in order, across pages", async () => {
    const t = table(idList(2366));
    const rows = await fetchAllByKeyset(t.keysetPage, (id) => id);
    expect(rows).toEqual(t.data);
  });

  it("does not skip or repeat rows when a row is inserted mid-read (the offset-paging gap)", async () => {
    const original = idList(2400);

    // Offset paging: a row inserted into page 0 after page 0 was read shifts the
    // later pages, so a row is read twice (or, with a stale page, missed).
    const offsetTable = table(original);
    const offsetRows: string[] = [];
    let insertedOffset = false;
    for (let from = 0; ; from += 1000) {
      const { data } = await offsetTable.offsetPage(from, from + 999);
      offsetRows.push(...(data ?? []));
      if (!insertedOffset) {
        offsetTable.insert("TG-00001");
        insertedOffset = true;
      }
      if ((data ?? []).length < 1000) break;
    }
    expect(new Set(offsetRows).size).not.toBe(offsetRows.length);

    // Keyset paging over the same change: every original row exactly once.
    const keyTable = table(original);
    let inserted = false;
    const rows = await fetchAllByKeyset(
      async (after, limit) => {
        const page = await keyTable.keysetPage(after, limit);
        if (!inserted) {
          keyTable.insert("TG-00001");
          inserted = true;
        }
        return page;
      },
      (id) => id,
    );
    expect(new Set(rows).size).toBe(rows.length);
    for (const id of original) expect(rows).toContain(id);
  });

  it("handles an exact multiple of the page size and an empty table", async () => {
    const t = table(idList(2000));
    expect(await fetchAllByKeyset(t.keysetPage, (id) => id)).toHaveLength(2000);
    expect(await fetchAllByKeyset(table([]).keysetPage, (id) => id)).toEqual([]);
  });

  it("throws the database error and stops if keys stop advancing", async () => {
    await expect(fetchAllByKeyset(async () => ({ data: null, error: { message: "boom" } }), (x: string) => x)).rejects.toThrow(
      "boom",
    );
    let calls = 0;
    const stuck = async (): Promise<PageResult<string>> => {
      calls++;
      return { data: ["a", "a"], error: null };
    };
    expect(await fetchAllByKeyset(stuck, (x) => x, 2)).toHaveLength(4);
    expect(calls).toBe(2);
  });
});

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
