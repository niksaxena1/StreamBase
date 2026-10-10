import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), transaction: vi.fn(), service: vi.fn(), schema: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) }, rpc: mocks.admin,
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: mocks.service }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn,
}));
import { POST } from "./route";

const payload = {
  label: { mode: "new", display_name: "New Label" },
  playlist: {
    display_name: "New Label Releases", spotify_playlist: "07MzpeD6a32EYRKuxp60o0",
    sot_playlist: "123", sot_dashboard_url: "https://www.spotontrack.com/dashboard/456",
  },
};
const saved = {
  label_key: "new_label", playlist_key: "new_label_releases", created_label: true, already_exists: false,
  label: { label_key: "new_label", display_name: "New Label", accent_hex: null, is_active: true },
  playlist: { playlist_key: "new_label_releases", label_key: "new_label", is_active: true },
};
const request = () => new Request("http://localhost/api/competitors/onboard", {
  method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ data: true, error: null });
  mocks.service.mockReturnValue({ schema: mocks.schema });
  mocks.schema.mockReturnValue({ rpc: mocks.transaction, from: mocks.from });
  mocks.from.mockImplementation(() => { throw new Error("Split table requests are forbidden"); });
  mocks.transaction.mockResolvedValue({ data: saved, error: null });
});

describe("atomic competitor onboarding regressions", () => {
  it("saves both records through one competitor RPC after the admin check", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.schema).toHaveBeenCalledExactlyOnceWith("competitor");
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith("onboard_competitor", {
      p_label_mode: "new", p_label_key: "new_label", p_label_display_name: "New Label", p_accent_hex: null,
      p_playlist_key: "new_label_releases", p_playlist_display_name: "New Label Releases",
      p_spotify_playlist_id: "07MzpeD6a32EYRKuxp60o0", p_sot_playlist_id: 123,
      p_sot_dashboard_url: "https://www.spotontrack.com/dashboard/456",
      p_sot_dashboard_name: "New Label Releases", p_min_rows: 1,
    });
    expect(mocks.admin.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
    expect(mocks.from).not.toHaveBeenCalled();
    expect((await response.json()).data).toEqual(saved);
  });

  it("returns 200 and existing records when an identical request retries a lost response", async () => {
    // The DB transaction committed both records, but its response was lost.
    mocks.transaction.mockRejectedValueOnce(new Error("Response lost after commit"));
    expect((await POST(request())).status).toBe(500);
    const existing = { ...saved, created_label: false, already_exists: true };
    mocks.transaction.mockResolvedValueOnce({ data: existing, error: null });
    const retry = await POST(request());
    expect(retry.status).toBe(200);
    expect((await retry.json()).data).toEqual(existing);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls[0]).toEqual(mocks.transaction.mock.calls[1]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
