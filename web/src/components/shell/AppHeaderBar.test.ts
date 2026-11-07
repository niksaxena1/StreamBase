import { describe, expect, it } from "vitest";

import { headerScrollsAway } from "./AppHeaderBar";

describe("headerScrollsAway", () => {
  it("lets the header scroll away on playlists and catalog pages", () => {
    expect(headerScrollsAway("/playlists")).toBe(true);
    expect(headerScrollsAway("/playlists/config")).toBe(true);
    expect(headerScrollsAway("/catalog")).toBe(true);
    expect(headerScrollsAway("/catalog/config/tracks")).toBe(true);
  });

  it("keeps the header sticky everywhere else", () => {
    expect(headerScrollsAway("/")).toBe(false);
    expect(headerScrollsAway("/playlist-watch")).toBe(false);
    expect(headerScrollsAway("/catalogue")).toBe(false);
    expect(headerScrollsAway("/competitors")).toBe(false);
    expect(headerScrollsAway(null)).toBe(false);
  });
});
