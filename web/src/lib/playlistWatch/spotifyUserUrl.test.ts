import { describe, expect, it } from "vitest";

import { spotifyUserUrl } from "@/lib/playlistWatch/spotifyUserUrl";

describe("spotifyUserUrl", () => {
  it("builds a Spotify user URL from an owner id", () => {
    expect(spotifyUserUrl("Happy Vibes")).toBe("https://open.spotify.com/user/Happy%20Vibes");
  });

  it("returns null for blank ids", () => {
    expect(spotifyUserUrl("")).toBeNull();
  });
});
