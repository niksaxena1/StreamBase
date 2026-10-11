import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRememberedOwnArtistValid } from "./rememberedArtist.actions";

const fixture = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), query: vi.fn(), contains: vi.fn() }));
vi.mock("@/lib/requestAppContext.server", () => ({ getRequestAppContext: fixture.context }));
beforeEach(() => {
  vi.clearAllMocks();
  const builder = { select: vi.fn().mockReturnThis(), contains: fixture.contains.mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: fixture.query };
  fixture.from.mockReturnValue(builder);
  fixture.query.mockResolvedValue({ data: { isrc: "track" }, error: null });
  fixture.context.mockResolvedValue({ user: { id: "user" }, isAdmin: true, shellContext: { datasetMode: "own" }, svc: { from: fixture.from } });
});
describe("remembered own artist validation", () => {
  it("checks the stable tracks universe rather than image metadata", async () => {
    expect(await isRememberedOwnArtistValid("long-tail")).toBe(true);
    expect(fixture.from).toHaveBeenCalledExactlyOnceWith("tracks");
    expect(fixture.contains).toHaveBeenCalledExactlyOnceWith("spotify_artist_ids", ["long-tail"]);
  });
  it("silently rejects missing artists, query errors, and outages", async () => {
    fixture.query.mockResolvedValueOnce({ data: null, error: null });
    expect(await isRememberedOwnArtistValid("unknown")).toBe(false);
    fixture.query.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } });
    expect(await isRememberedOwnArtistValid("unknown")).toBe(false);
    fixture.context.mockRejectedValueOnce(new Error("offline"));
    expect(await isRememberedOwnArtistValid("unknown")).toBe(false);
  });
  it("gates public reads by authentication, admin access, and own dataset mode", async () => {
    for (const context of [
      { user: null, isAdmin: true, shellContext: { datasetMode: "own" } },
      { user: { id: "user" }, isAdmin: false, shellContext: { datasetMode: "own" } },
      { user: { id: "user" }, isAdmin: true, shellContext: { datasetMode: "competitor" } },
    ]) {
      fixture.context.mockResolvedValueOnce({ ...context, svc: { from: fixture.from } });
      expect(await isRememberedOwnArtistValid("artist")).toBe(false);
    }
    expect(fixture.from).not.toHaveBeenCalled();
  });
});
