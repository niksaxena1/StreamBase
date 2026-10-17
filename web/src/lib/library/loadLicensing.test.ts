import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], requests: [] as string[][], fail: false }));
vi.mock("@/lib/supabase/catalogService", () => ({ catalogService: () => ({ from: (table: string) => {
  expect(table).toBe("pack_tracks");
  let ids: string[] = [];
  const q = {
    select: () => q,
    in: (_key: string, selected: string[]) => { ids = selected; return q; },
    order: () => q,
    range: async (from: number, to: number) => {
      state.requests.push(ids);
      return { data: state.rows.filter((r) => ids.includes(String(r.catalog_id))).slice(from, to + 1), error: state.fail ? { message: "Unavailable" } : null };
    },
  };
  return q;
} }) }));

import { loadLibraryLicensing } from "./loadLicensing";

const membership = (catalogId: string, packId: number, batchDate = "2026-10-17") => ({
  catalog_id: catalogId, pack_id: packId, status: "staged", status_on: "2026-10-17",
  dropbox_path: "/Licensing/Evenfall", shared_link: "https://www.dropbox.com/s/test",
  packs: { name: `Batch ${packId}`, licensee: "Evenfall", batch_date: batchDate },
});

beforeEach(() => { state.rows = []; state.requests = []; state.fail = false; });

describe("licensing detail loader", () => {
  it("joins pack metadata, keeps links and sorts batches newest first", async () => {
    state.rows = [membership("TG-1", 1, "2026-08-12"), membership("TG-1", 2), membership("TG-2", 3)];
    const result = await loadLibraryLicensing(["TG-1"]);
    expect(result.map((b) => b.pack_id)).toEqual([2, 1]);
    expect(result[0]).toMatchObject({ catalog_id: "TG-1", licensee: "Evenfall", pack: "Batch 2", status: "staged", batch_date: "2026-10-17", dropbox_path: "/Licensing/Evenfall", shared_link: "https://www.dropbox.com/s/test" });
  });
  it("reads beyond the PostgREST limit and chunks large ID selections", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `TG-${i}`);
    state.rows = [...Array.from({ length: 1001 }, (_, i) => membership("TG-0", i + 1)), membership("TG-100", 2000)];
    const result = await loadLibraryLicensing(ids);
    expect(result).toHaveLength(1002);
    expect(state.requests.map((r) => r.length)).toEqual([100, 100, 1]);
  });
  it("skips malformed records and surfaces database errors", async () => {
    state.rows = [{ ...membership("TG-1", 1), status: "invalid" }, membership("TG-1", 2)];
    expect(await loadLibraryLicensing(["TG-1"])).toHaveLength(1);
    state.fail = true;
    await expect(loadLibraryLicensing(["TG-1"])).rejects.toThrow("Unavailable");
  });
});
