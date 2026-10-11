import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastArtistIdStorageKey } from "@/lib/datasetSelectionStorage";
import { useSyncCatalogSelection } from "./useSyncCatalogSelection";

const fixture = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, replace: vi.fn(), valid: vi.fn() }));
vi.mock("react", () => ({ useEffect: (effect: () => void) => fixture.effects.push(effect) }));
vi.mock("@/components/shell/useNavigationRouter", () => ({ useNavigationRouter: () => ({ replace: fixture.replace }) }));
vi.mock("./rememberedArtist.actions", () => ({ isRememberedOwnArtistValid: fixture.valid }));

let values: Map<string, string>;
let historyReplace: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fixture.effects.length = 0;
  fixture.replace.mockReset();
  fixture.valid.mockReset().mockResolvedValue(false);
  values = new Map();
  historyReplace = vi.fn();
  vi.stubGlobal("window", { location: { href: "https://fixture.invalid/catalog" }, history: { replaceState: historyReplace } });
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
function CatalogTest(mode: "own" | "competitor" = "own", label: string | null = null, ids = ["default", "remembered"]) {
  useSyncCatalogSelection("default", "track", mode, label, ids.map((id) => ({ id })));
  return null;
}
async function render(mode: "own" | "competitor" = "own", label: string | null = null, ids = ["default", "remembered"]) {
  CatalogTest(mode, label, ids);
  fixture.effects.pop()?.();
  await Promise.resolve();
  await Promise.resolve();
}

describe("catalog artist memory", () => {
  it("writes every viewed artist and respects explicit artist/track links", async () => {
    window.location.href = "https://fixture.invalid/catalog?artist_id=default&isrc=track";
    values.set(lastArtistIdStorageKey("own"), "remembered");
    await render();
    expect(values.get(lastArtistIdStorageKey("own"))).toBe("default");
    expect(fixture.replace).not.toHaveBeenCalled();
  });
  it("restores a valid remembered artist once with replace and preserves other params", async () => {
    window.location.href = "https://fixture.invalid/catalog?range=90#chart";
    values.set(lastArtistIdStorageKey("own"), " remembered ");
    await render();
    expect(fixture.replace).toHaveBeenCalledExactlyOnceWith("/catalog?range=90&artist_id=remembered#chart");
    expect(historyReplace).not.toHaveBeenCalled();
    expect(fixture.valid).not.toHaveBeenCalled();
  });
  it("silently defaults when own remembered ids are unknown", async () => {
    values.set(lastArtistIdStorageKey("own"), "unknown");
    await render();
    expect(fixture.valid).toHaveBeenCalledExactlyOnceWith("unknown");
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(historyReplace).toHaveBeenCalledExactlyOnceWith(null, "", "/catalog?artist_id=default&isrc=track");
    expect(values.get(lastArtistIdStorageKey("own"))).toBe("default");
  });
  it("accepts valid long-tail own artists outside the capped dropdown", async () => {
    values.set(lastArtistIdStorageKey("own"), "long-tail");
    fixture.valid.mockResolvedValue(true);
    await render();
    expect(fixture.replace).toHaveBeenCalledExactlyOnceWith("/catalog?artist_id=long-tail");
  });
  it("separates own, all competitors, and individual labels without migrating cross-label legacy memory", async () => {
    expect(lastArtistIdStorageKey("own", "a")).toBe("sb:last_artist_id:own");
    expect(lastArtistIdStorageKey("competitor", "a")).toBe("sb:last_artist_id:competitor:a");
    expect(lastArtistIdStorageKey("competitor", null)).toBe("sb:last_artist_id:competitor:__all__");
    values.set(lastArtistIdStorageKey("own"), "remembered");
    values.set(lastArtistIdStorageKey("competitor", "a"), "remembered");
    values.set("sb:last_artist_id:competitor", "remembered");
    await render("competitor", "b");
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(values.get(lastArtistIdStorageKey("competitor", "b"))).toBe("default");
    expect(values.get(lastArtistIdStorageKey("competitor", "a"))).toBe("remembered");
  });
  it("rejects unknown or cross-label competitor artists without consulting public data", async () => {
    values.set(lastArtistIdStorageKey("competitor", "b"), "unknown");
    await render("competitor", "b");
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(fixture.valid).not.toHaveBeenCalled();
    expect(historyReplace).toHaveBeenCalled();
  });
  it("keeps the server default when it matches memory", async () => {
    values.set(lastArtistIdStorageKey("own"), "default");
    await render();
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(fixture.valid).not.toHaveBeenCalled();
    expect(historyReplace).toHaveBeenCalled();
  });
  it("does not restore stale async memory after another navigation", async () => {
    values.set(lastArtistIdStorageKey("own"), "long-tail");
    let resolve!: (valid: boolean) => void;
    fixture.valid.mockReturnValue(new Promise<boolean>((done) => { resolve = done; }));
    await render();
    window.location.href = "https://fixture.invalid/playlists";
    resolve(true);
    await Promise.resolve();
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(historyReplace).not.toHaveBeenCalled();
  });
});
