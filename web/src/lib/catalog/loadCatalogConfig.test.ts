import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCatalogConfigTracks } from "./loadCatalogConfig";

const fixture = vi.hoisted(() => ({
  rpc: vi.fn(), status: vi.fn(), warn: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    rpc: fixture.rpc,
    from: () => ({ select: () => ({ in: fixture.status }) }),
  }),
}));
vi.mock("@/lib/supabase/cache", () => ({ cachedQuery: (fn: () => unknown) => fn() }));
vi.mock("@/lib/logger", () => ({ logWarn: fixture.warn }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.rpc.mockResolvedValue({ data: [{ isrc: "PENDING", name: "Pending track", spotify_album_image_url: null }], error: null });
  fixture.status.mockResolvedValue({ data: [{ isrc: "PENDING", spotify_not_found_since: "2026-10-01" }], error: null });
});

describe("catalog config Spotify status hydration", () => {
  it("adds status to placeholders when hydration succeeds", async () => {
    const result = await loadCatalogConfigTracks();
    expect(result.errorMessage).toBeNull();
    expect(result.tracks[0].spotify_not_found_since).toBe("2026-10-01");
    expect(fixture.status).toHaveBeenCalledExactlyOnceWith("isrc", ["PENDING"]);
  });

  it.each(["response", "exception"])("keeps the page usable after a hydration %s failure", async (failure) => {
    if (failure === "response") fixture.status.mockResolvedValue({ data: null, error: { message: "offline" } });
    else fixture.status.mockRejectedValue(new Error("offline"));
    const result = await loadCatalogConfigTracks();
    expect(result.errorMessage).toBeNull();
    expect(result.tracks.map((track) => track.isrc)).toEqual(["PENDING"]);
    expect(result.tracks[0].spotify_not_found_since).toBeUndefined();
    expect(fixture.warn).toHaveBeenCalledOnce();
  });

  it("avoids status hydration for tracks with artwork", async () => {
    fixture.rpc.mockResolvedValue({ data: [{ isrc: "ARTWORK", spotify_album_image_url: "cover" }], error: null });
    expect((await loadCatalogConfigTracks()).tracks).toHaveLength(1);
    expect(fixture.status).not.toHaveBeenCalled();
  });
});
