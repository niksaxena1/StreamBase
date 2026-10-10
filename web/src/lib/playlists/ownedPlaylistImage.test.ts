import { describe, expect, it } from "vitest";

import { isOwnedPlaylistImageUrl } from "./ownedPlaylistImage";

describe("isOwnedPlaylistImageUrl", () => {
  it("treats local public logos as owned", () => {
    expect(isOwnedPlaylistImageUrl("/playlist-logos/landr.png")).toBe(true);
  });

  it("treats Supabase Storage public URLs as owned", () => {
    expect(
      isOwnedPlaylistImageUrl(
        "https://ucbbxzotbhkehjgbvdfm.supabase.co/storage/v1/object/public/playlist-logos/tg_amuse.jpg",
      ),
    ).toBe(true);
  });

  it("does not treat Spotify CDN URLs as owned", () => {
    expect(isOwnedPlaylistImageUrl("https://mosaic.scdn.co/640/abc")).toBe(false);
    expect(isOwnedPlaylistImageUrl("https://i.scdn.co/image/abc")).toBe(false);
    expect(isOwnedPlaylistImageUrl(null)).toBe(false);
  });
});
