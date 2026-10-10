import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  service: vi.fn(),
  schema: vi.fn(),
  path: vi.fn(),
  tag: vi.fn(),
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

type Result = { data: unknown; error: { code?: string; message: string } | null };
type Query = { table: string; operation?: string; payload?: unknown; filters: Record<string, unknown> };
let results: (Result | Error)[];
let queries: Query[];
const ok = (data: unknown = null): Result => ({ data, error: null });
const fail = (code: string): Result => ({ data: null, error: { code, message: "Insert failed" } });

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

function lookups(label: unknown = null) {
  results = [ok(label), ok(), ok([]), ok([]), ok([]), ok([{ display_order: 4 }])];
}

beforeEach(() => {
  vi.resetAllMocks();
  queries = [];
  lookups();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "admin" } } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.service.mockReturnValue({ schema: mocks.schema });
  mocks.schema.mockImplementation((schema: string) => {
    expect(schema).toBe("competitor");
    return {
      from(table: string) {
        const result = results.shift();
        if (!result) throw new Error("Unexpected query");
        const query: Query = { table, filters: {} };
        queries.push(query);
        const chain = {
          select() { query.operation = "select"; return chain; },
          eq(key: string, value: unknown) { query.filters[key] = value; return chain; },
          limit() { return chain; },
          order() { return chain; },
          maybeSingle() { return chain; },
          insert(payload: unknown) { query.operation = "insert"; query.payload = payload; return chain; },
          update(payload: unknown) { query.operation = "update"; query.payload = payload; return chain; },
          delete() { query.operation = "delete"; return chain; },
          then(resolve: (value: Result) => unknown, reject: (error: Error) => unknown) {
            return (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
          },
        };
        return chain;
      },
    };
  });
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
    results.push(ok(), ok());
    const res = await POST(request());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, data: {
      label_key: "new_label", playlist_key: "new_label_releases", created_label: true,
    } });
    expect(mocks.rpc).toHaveBeenCalledWith("is_admin");
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
    expect(queries.filter((q) => q.operation === "insert")).toEqual([
      { table: "labels", operation: "insert", filters: {}, payload: {
        label_key: "new_label", display_name: "New Label", accent_hex: null, is_active: true,
      } },
      { table: "playlists", operation: "insert", filters: {}, payload: {
        playlist_key: "new_label_releases", label_key: "new_label", display_name: "New Label Releases",
        spotify_playlist_id: "07MzpeD6a32EYRKuxp60o0", sot_playlist_id: 123,
        sot_dashboard_url: "https://www.spotontrack.com/dashboard/456", sot_dashboard_name: "New Label Releases",
        min_rows: 1, display_order: 5, is_active: true,
      } },
    ]);
    expect(results).toEqual([]);
    expect(mocks.path).toHaveBeenCalledWith("/competitors");
    expect(mocks.tag).toHaveBeenCalledExactlyOnceWith(cacheTagForKey("competitor-shell-labels-v2"), { expire: 0 });
  });

  it("adds to an existing label without inserting or deleting that label", async () => {
    lookups({ label_key: "soave", is_active: true });
    results.push(ok());
    expect((await POST(request({ ...body, label: { mode: "existing", label_key: "soave" } }))).status).toBe(201);
    expect(queries.filter((q) => q.table === "labels").map((q) => q.operation)).toEqual(["select"]);
  });

  it("reactivates an inactive existing label", async () => {
    lookups({ label_key: "soave", is_active: false });
    results.push(ok(), ok());
    expect((await POST(request({ ...body, label: { mode: "existing", label_key: "soave" } }))).status).toBe(201);
    expect(queries.find((q) => q.operation === "update")).toMatchObject({
      table: "labels", filters: { label_key: "soave" }, payload: { is_active: true },
    });
  });

  it.each([
    [0, "label.label_key"], [1, "playlist.playlist_key"], [2, "playlist.spotify_playlist"],
    [3, "playlist.sot_playlist"], [4, "playlist.sot_dashboard_url"],
  ])("rejects duplicate identity lookup %s before any writes", async (index, field) => {
    results[index as number] = ok(index === 0 ? { label_key: "new_label" } : index === 1
      ? { playlist_key: "tracked" } : [{ playlist_key: "tracked" }]);
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect((await res.json()).fields).toHaveProperty(field as string);
    expect(queries.every((q) => q.operation === "select")).toBe(true);
    expect(mocks.tag).not.toHaveBeenCalled();
  });

  it("rejects unknown existing labels and lookup failures before writing", async () => {
    expect((await POST(request({ ...body, label: { mode: "existing", label_key: "unknown" } }))).status).toBe(400);
    lookups();
    results[3] = fail("42703");
    expect((await POST(request())).status).toBe(500);
    expect(queries.every((q) => q.operation === "select")).toBe(true);
  });

  it.each(["42703", "PGRST204", "23505", "other", "throw"])("rolls back the new label on playlist failure %s", async (code) => {
    results.push(ok(), code === "throw" ? new Error("Transport failure") : fail(code), ok());
    const res = await POST(request());
    expect(res.status).toBe(["42703", "PGRST204"].includes(code) ? 503 : code === "23505" ? 409 : 500);
    expect(queries.at(-1)).toEqual({ table: "labels", operation: "delete", filters: { label_key: "new_label" } });
    if (["42703", "PGRST204"].includes(code)) {
      expect((await res.json()).error).toContain("migrations/add_competitor_onboarding_config_columns.sql");
    }
    expect(results).toEqual([]);
  });

  it("does not roll back an existing label on playlist failure", async () => {
    lookups({ label_key: "soave", is_active: true });
    results.push(fail("other"));
    expect((await POST(request({ ...body, label: { mode: "existing", label_key: "soave" } }))).status).toBe(500);
    expect(queries.some((q) => q.operation === "delete")).toBe(false);
  });

  it("does not insert a playlist after label insertion fails", async () => {
    results.push(fail("23505"));
    expect((await POST(request())).status).toBe(409);
    expect(queries.at(-1)?.table).toBe("labels");
    expect(queries.some((q) => q.operation === "delete")).toBe(false);
  });

  it("returns an error if rollback fails", async () => {
    results.push(ok(), fail("other"), fail("other"));
    expect((await POST(request())).status).toBe(500);
  });
});
