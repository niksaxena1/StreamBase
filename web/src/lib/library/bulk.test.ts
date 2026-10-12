import { describe, expect, it, vi } from "vitest";

import {
  BULK_CHUNK_SIZE,
  BULK_MAX_IDS,
  buildBulkChanges,
  bulkConfirmText,
  chunkIds,
  cleanBulkIds,
  runBulkUpdate,
  validateBulkChanges,
} from "./bulk";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `TG-${String(i).padStart(5, "0")}`);

describe("chunkIds", () => {
  it("splits into chunks of 500 and keeps order", () => {
    const chunks = chunkIds(ids(1203));
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 203]);
    expect(chunks.flat()).toEqual(ids(1203));
  });
  it("handles exact multiples and empty input", () => {
    expect(chunkIds(ids(BULK_CHUNK_SIZE)).length).toBe(1);
    expect(chunkIds(ids(BULK_CHUNK_SIZE * 2)).length).toBe(2);
    expect(chunkIds([])).toEqual([]);
  });
});

describe("buildBulkChanges", () => {
  it("builds a one-field payload with trimmed text", () => {
    expect(buildBulkChanges("entity", " legacy ")).toEqual({ entity: "legacy" });
    expect(buildBulkChanges("label_genre", "Deep House")).toEqual({ label_genre: "Deep House" });
  });
  it("clears clearable fields with null and refuses a blank entity", () => {
    expect(buildBulkChanges("distributor_account", "  ")).toEqual({ distributor_account: null });
    expect(buildBulkChanges("originality", "")).toEqual({ originality: null });
    expect(buildBulkChanges("entity", "")).toBeNull();
  });
});

describe("validateBulkChanges", () => {
  it("accepts the five bulk fields", () => {
    expect(validateBulkChanges({ exclusivity: "Exclusive" })).toEqual({ ok: true, changes: { exclusivity: "Exclusive" } });
    expect(validateBulkChanges({ label_genre: "  " })).toEqual({ ok: true, changes: { label_genre: null } });
  });
  it("rejects isrc, upc, unknown keys, bad types and a blank entity", () => {
    expect(validateBulkChanges({ isrc: "USABC2600001" }).ok).toBe(false);
    expect(validateBulkChanges({ upc: "012345678905" }).ok).toBe(false);
    expect(validateBulkChanges({ release_date: "2026-01-01" }).ok).toBe(false);
    expect(validateBulkChanges({ entity: 5 }).ok).toBe(false);
    expect(validateBulkChanges({ entity: null }).ok).toBe(false);
    expect(validateBulkChanges({}).ok).toBe(false);
    expect(validateBulkChanges(null).ok).toBe(false);
    expect(validateBulkChanges([]).ok).toBe(false);
  });
});

describe("cleanBulkIds", () => {
  const pattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  it("dedupes and keeps order", () => {
    expect(cleanBulkIds(["TG-1", "P-2", "TG-1"], pattern)).toEqual(["TG-1", "P-2"]);
  });
  it("rejects malformed, empty and oversized lists", () => {
    expect(cleanBulkIds(["TG-1", "bad id"], pattern)).toBeNull();
    expect(cleanBulkIds([1], pattern)).toBeNull();
    expect(cleanBulkIds([], pattern)).toBeNull();
    expect(cleanBulkIds("TG-1", pattern)).toBeNull();
    expect(cleanBulkIds(ids(BULK_MAX_IDS + 1), pattern)).toBeNull();
    expect(cleanBulkIds(ids(BULK_MAX_IDS), pattern)?.length).toBe(BULK_MAX_IDS);
  });
});

describe("runBulkUpdate", () => {
  it("calls the RPC once per chunk and sums the changed counts", async () => {
    const call = vi.fn(async (chunk: string[]) => ({ changed: chunk.length - 1 }));
    const res = await runBulkUpdate(ids(1100), call);
    expect(call.mock.calls.map((c) => c[0].length)).toEqual([500, 500, 100]);
    expect(res).toEqual({ updated: 1097, processed: 1100, error: null });
  });
  it("stops at the first failing chunk and reports progress", async () => {
    let n = 0;
    const res = await runBulkUpdate(ids(1100), async (chunk) => {
      n++;
      return n === 2 ? { error: "boom" } : { changed: chunk.length };
    });
    expect(res).toEqual({ updated: 500, processed: 500, error: "boom" });
  });
  it("turns a thrown error into a failure", async () => {
    const res = await runBulkUpdate(ids(10), async () => {
      throw new Error("network down");
    });
    expect(res).toEqual({ updated: 0, processed: 0, error: "network down" });
  });
});

describe("bulkConfirmText", () => {
  it("names the field, value and count", () => {
    expect(bulkConfirmText("entity", "Legacy", 214)).toBe("Change Entity to Legacy for 214 releases?");
    expect(bulkConfirmText("label_genre", "House", 1)).toBe("Change Label / Genre to House for 1 release?");
    expect(bulkConfirmText("distributor_account", "", 1200)).toBe("Clear Distributor for 1,200 releases?");
  });
});
