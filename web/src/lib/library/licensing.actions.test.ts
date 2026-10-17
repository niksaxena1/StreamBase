import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  gate: { ok: true, actor: "admin@example.com" } as { ok: true; actor: string } | { ok: false; error: string },
  rpc: vi.fn(), expire: vi.fn(),
  readRow: vi.fn(), readDetail: vi.fn(), readLicensing: vi.fn(),
}));
vi.mock("@/lib/library/adminGate.server", () => ({ requireLibraryAdmin: async () => state.gate }));
vi.mock("@/lib/supabase/catalogService", () => ({ catalogService: () => ({ schema: () => ({ rpc: state.rpc }) }) }));
vi.mock("@/lib/library/loadLibraryTrack", () => ({ loadLibraryOverviewRow: state.readRow, loadLibraryTrackDetail: state.readDetail }));
vi.mock("@/lib/library/loadLicensing", () => ({ loadLibraryLicensing: state.readLicensing }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: state.expire, revalidateTag: vi.fn() }));

import { fetchLibraryLicensing, setLibraryPackTrackStatus } from "@/app/(main-flat)/library/library.actions";
import { makeRow } from "./testRows";

beforeEach(() => {
  state.gate = { ok: true, actor: "admin@example.com" };
  state.rpc.mockReset().mockResolvedValue({ data: 2, error: null });
  state.expire.mockClear();
  state.readRow.mockReset().mockResolvedValue(makeRow());
  state.readDetail.mockReset().mockResolvedValue({ files: [], isrcs: [], upcs: [], history: [], licensing: [] });
  state.readLicensing.mockReset().mockResolvedValue([]);
});

describe("pack status action", () => {
  it("gates admin access before calling the RPC", async () => {
    state.gate = { ok: false, error: "Admin only" };
    expect(await setLibraryPackTrackStatus(1, ["TG-1"], "sent")).toMatchObject({ ok: false, error: "Admin only" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid pack IDs, catalog IDs and statuses", async () => {
    for (const args of [[0, ["TG-1"], "sent"], [1.5, ["TG-1"], "sent"], [1, [], "sent"], [1, ["bad id"], "sent"], [1, ["TG-1"], "bad"]]) {
      expect(await setLibraryPackTrackStatus(...args as [unknown, unknown, unknown])).toMatchObject({ ok: false });
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("passes the batch, unique IDs, status and gated actor; expires the overview", async () => {
    const result = await setLibraryPackTrackStatus(12, ["TG-1", "P-2", "TG-1"], "sent");
    expect(result).toMatchObject({ ok: true, updated: 2, total: 2 });
    expect(state.rpc).toHaveBeenCalledWith("set_pack_track_status", { p_pack_id: 12, p_catalog_ids: ["TG-1", "P-2"], p_status: "sent", p_actor: "admin@example.com" });
    expect(state.expire).toHaveBeenCalled();
  });
  it("returns RPC errors and thrown failures without reporting success", async () => {
    state.rpc.mockResolvedValueOnce({ error: { message: "Batch unavailable" } });
    expect(await setLibraryPackTrackStatus(1, ["TG-1"], "staged")).toMatchObject({ ok: false, error: "Batch unavailable" });
    state.rpc.mockRejectedValueOnce(new Error("Offline"));
    expect(await setLibraryPackTrackStatus(1, ["TG-1"], "sent")).toMatchObject({ ok: false });
    expect(state.expire).not.toHaveBeenCalled();
  });
  it("returns fresh single-track data and treats a failed re-read as a successful write", async () => {
    state.rpc.mockResolvedValue({ data: 1, error: null });
    expect(await setLibraryPackTrackStatus(1, ["TG-1"], "sent")).toMatchObject({ ok: true, updated: 1, row: { catalog_id: "TG-00001" }, detail: { licensing: [] } });
    expect(state.readRow).toHaveBeenCalledWith("TG-1");
    state.readRow.mockRejectedValueOnce(new Error("Read failed"));
    expect(await setLibraryPackTrackStatus(1, ["TG-1"], "staged")).toMatchObject({ ok: true, updated: 1, row: null, detail: null });
  });
  it("handles idempotent status updates without losing cache invalidation", async () => {
    state.rpc.mockResolvedValue({ data: 0, error: null });
    expect(await setLibraryPackTrackStatus(1, ["TG-1"], "sent")).toMatchObject({ ok: true, updated: 0 });
    expect(state.expire).toHaveBeenCalled();
  });
  it("gates and validates on-demand batch reads, and returns database errors", async () => {
    state.gate = { ok: false, error: "Admin only" };
    expect(await fetchLibraryLicensing(["TG-1"])).toMatchObject({ ok: false });
    expect(state.readLicensing).not.toHaveBeenCalled();
    state.gate = { ok: true, actor: "admin@example.com" };
    expect(await fetchLibraryLicensing([])).toMatchObject({ ok: false });
    expect(await fetchLibraryLicensing(["TG-1", "TG-1"])).toEqual({ ok: true, batches: [] });
    expect(state.readLicensing).toHaveBeenCalledWith(["TG-1"]);
    state.readLicensing.mockRejectedValueOnce(new Error("Unavailable"));
    expect(await fetchLibraryLicensing(["TG-1"])).toMatchObject({ ok: false });
  });
});
