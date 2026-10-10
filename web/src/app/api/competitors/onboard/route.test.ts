import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  service: vi.fn(),
  schema: vi.fn(),
  path: vi.fn(),
  tag: vi.fn(),
  transaction: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: mocks.service }));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.path, revalidateTag: mocks.tag, unstable_cache: (fn: unknown) => fn,
}));

import { POST } from "./route";
import { cacheTagForKey } from "@/lib/supabase/cache";

const ok = (data: unknown): { data: unknown; error: null } => ({ data, error: null });
const fail = (code: string, details = "") => ({ data: null, error: { code, details, message: "Onboarding failed" } });
const saved = {
  label_key: "new_label", playlist_key: "new_label_releases", created_label: true, already_exists: false,
  label: { label_key: "new_label", display_name: "New Label", accent_hex: null, is_active: true },
  playlist: { playlist_key: "new_label_releases", label_key: "new_label", display_order: 5, is_active: true },
};

const body = {
  label: { mode: "new", display_name: "New Label" },
  playlist: {
    display_name: "New Label Releases",
    spotify_playlist: "https://open.spotify.com/playlist/07MzpeD6a32EYRKuxp60o0",
    sot_playlist: "https://www.spotontrack.com/playlists/spotify/123",
    sot_dashboard_url: "https://www.spotontrack.com/dashboard/456?tab=tracks",
  },
};

function request(payload: unknown = body) {
  return new Request("http://localhost/api/competitors/onboard", {
    method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.service.mockReturnValue({ schema: mocks.schema });
  mocks.schema.mockReturnValue({ rpc: mocks.transaction, from: mocks.from });
  mocks.from.mockImplementation(() => { throw new Error("Use the atomic RPC, not table requests"); });
  mocks.transaction.mockResolvedValue(ok(saved));
});

describe("POST /api/competitors/onboard", () => {
  it.each([401, 403, 500])("requires admin authorization before service-role access (%s)", async (status) => {
    if (status === 401) mocks.getUser.mockResolvedValue({ data: { user: null } });
    if (status === 403) mocks.rpc.mockResolvedValue({ data: false, error: null });
    if (status === 500) mocks.rpc.mockResolvedValue({ data: null, error: { message: "Auth failed" } });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and invalid fields before service-role access", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await POST(request({ ...body, playlist: { ...body.playlist, min_rows: -1 } }))).status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("creates a label and playlist only in competitor with derived config", async () => {
    const res = await POST(request());
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual(saved);
    expect(mocks.rpc).toHaveBeenCalledWith("is_admin");
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
    expect(mocks.schema).toHaveBeenCalledExactlyOnceWith("competitor");
    expect(mocks.transaction).toHaveBeenCalledExactlyOnceWith("onboard_competitor", {
      p_label_mode: "new", p_label_key: "new_label", p_label_display_name: "New Label", p_accent_hex: null,
      p_playlist_key: "new_label_releases", p_playlist_display_name: "New Label Releases",
      p_spotify_playlist_id: "07MzpeD6a32EYRKuxp60o0", p_sot_playlist_id: 123,
      p_sot_dashboard_url: "https://www.spotontrack.com/dashboard/456",
      p_sot_dashboard_name: "New Label Releases", p_min_rows: 1,
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.path).toHaveBeenCalledWith("/competitors");
    expect(mocks.tag).toHaveBeenCalledExactlyOnceWith(cacheTagForKey("competitor-shell-labels-v2"), { expire: 0 });
  });

  it("adds to an existing label without requesting label creation", async () => {
    const existing = { ...saved, label_key: "soave", created_label: false, label: { ...saved.label, label_key: "soave" } };
    mocks.transaction.mockResolvedValue(ok(existing));
    const res = await POST(request({ ...body, label: { mode: "existing", label_key: "soave" } }));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual(existing);
    expect(mocks.transaction.mock.calls[0][1]).toMatchObject({
      p_label_mode: "existing", p_label_key: "soave", p_label_display_name: null, p_accent_hex: null,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns the existing label reactivated in the same transaction", async () => {
    const existing = { ...saved, label_key: "soave", created_label: false, label: { ...saved.label, label_key: "soave", is_active: true } };
    mocks.transaction.mockResolvedValue(ok(existing));
    const response = await POST(request({ ...body, label: { mode: "existing", label_key: "soave" } }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.label.is_active).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    "label.label_key", "playlist.playlist_key", "playlist.spotify_playlist",
    "playlist.sot_playlist", "playlist.sot_dashboard_url",
  ])("rejects duplicate %s with a field error and no separate writes", async (field) => {
    mocks.transaction.mockResolvedValue(fail("23505", field));
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect((await res.json()).fields).toEqual({ [field]: "Onboarding failed" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.tag).not.toHaveBeenCalled();
  });

  it("rejects unknown existing labels and transaction lookup failures", async () => {
    mocks.transaction.mockResolvedValueOnce(fail("22023", "label.label_key"));
    const unknown = await POST(request({ ...body, label: { mode: "existing", label_key: "unknown" } }));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).fields).toEqual({ "label.label_key": "Onboarding failed" });
    mocks.transaction.mockResolvedValueOnce(fail("08006"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["42703", "42883", "PGRST202", "PGRST204", "23505", "other", "throw"])("handles atomic failure %s without client-side compensating writes", async (code) => {
    if (code === "throw") mocks.transaction.mockRejectedValueOnce(new Error("Transport failure"));
    else mocks.transaction.mockResolvedValueOnce(fail(code));
    const res = await POST(request());
    const missing = ["42703", "42883", "PGRST202", "PGRST204"].includes(code);
    expect(res.status).toBe(missing ? 503 : code === "23505" ? 409 : 500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.tag).not.toHaveBeenCalled();
    if (missing) expect((await res.json()).error).toContain("supabase/migrations/20261010205727_add_competitor_onboarding_config_columns.sql");
  });

  it("does not delete an existing label on transaction failure", async () => {
    mocks.transaction.mockResolvedValueOnce(fail("other"));
    expect((await POST(request({ ...body, label: { mode: "existing", label_key: "soave" } }))).status).toBe(500);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not issue a separate playlist insert when label creation fails", async () => {
    mocks.transaction.mockResolvedValueOnce(fail("23505", "label.label_key"));
    expect((await POST(request())).status).toBe(409);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects malformed RPC results without refreshing caches", async () => {
    for (const value of [null, [], {}, { ...saved, label_key: "other" }, { ...saved, already_exists: undefined }]) {
      mocks.transaction.mockResolvedValueOnce(ok(value));
      expect((await POST(request())).status).toBe(500);
    }
    expect(mocks.tag).not.toHaveBeenCalled();
  });
});
