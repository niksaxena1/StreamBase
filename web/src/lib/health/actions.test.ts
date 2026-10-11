import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshHealthData } from "./actions";

const fixture = vi.hoisted(() => ({ auth: vi.fn(), recompute: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({}) }));
vi.mock("@/lib/api/server", () => ({ requireUser: fixture.auth }));
vi.mock("@/lib/health/activeWarnings", () => ({ recomputeActiveWarningSnapshot: fixture.recompute }));
vi.mock("next/cache", () => ({ updateTag: fixture.update }));
beforeEach(() => { vi.clearAllMocks(); fixture.auth.mockResolvedValue({ ok: true }); fixture.recompute.mockResolvedValue(undefined); });
describe("health read-your-own-writes refresh", () => {
  it("expires health immediately after the snapshot write completes", async () => {
    const order: string[] = [];
    fixture.recompute.mockImplementation(async () => { await Promise.resolve(); order.push("write"); });
    fixture.update.mockImplementation(() => order.push("expire"));
    await refreshHealthData();
    expect(fixture.update).toHaveBeenCalledExactlyOnceWith("health");
    expect(order).toEqual(["write", "expire"]);
  });
  it("does not write or invalidate for an unauthenticated request", async () => {
    fixture.auth.mockResolvedValue({ ok: false });
    await refreshHealthData();
    expect(fixture.recompute).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
  });
});
