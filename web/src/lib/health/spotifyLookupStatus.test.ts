import { describe, expect, it, vi } from "vitest";
import { hydrateSpotifyLookupStatus } from "./spotifyLookupStatus";
import type { TrackBase } from "./types";

describe("lookup status for legacy Health RPC rows", () => {
  it("hydrates only missing artwork with unknown status and deduplicates ISRCs", async () => {
    const pending: TrackBase = { isrc: "REMOVED", name: "Removed" };
    const duplicate: TrackBase = { ...pending };
    const rows: TrackBase[] = [pending, duplicate,
      { isrc: "ARTWORK", name: "Artwork", album_image_url: "cover" },
      { isrc: "KNOWN", name: "Known", spotify_not_found_since: null },
    ];
    const select = vi.fn();
    const inFilter = vi.fn().mockResolvedValue({ data: [{ isrc: "REMOVED", spotify_not_found_since: "2026-10-01" }] });
    select.mockReturnValue({ in: inFilter });
    const svc = { from: vi.fn().mockReturnValue({ select }) };
    await hydrateSpotifyLookupStatus(svc as unknown as Parameters<typeof hydrateSpotifyLookupStatus>[0], rows);
    expect(svc.from).toHaveBeenCalledExactlyOnceWith("tracks");
    expect(select).toHaveBeenCalledExactlyOnceWith("isrc,spotify_not_found_since");
    expect(inFilter).toHaveBeenCalledExactlyOnceWith("isrc", ["REMOVED"]);
    expect(pending.spotify_not_found_since).toBe("2026-10-01");
    expect(duplicate.spotify_not_found_since).toBe("2026-10-01");
  });

  it("keeps diagnostics usable when the tracking read fails", async () => {
    const row: TrackBase = { isrc: "REMOVED", name: "Removed" };
    const svc = { from: () => ({ select: () => ({ in: async () => { throw new Error("offline"); } }) }) };
    await expect(hydrateSpotifyLookupStatus(
      svc as unknown as Parameters<typeof hydrateSpotifyLookupStatus>[0], [row],
    )).resolves.toBeUndefined();
    expect(row.spotify_not_found_since).toBeUndefined();
  });
});
