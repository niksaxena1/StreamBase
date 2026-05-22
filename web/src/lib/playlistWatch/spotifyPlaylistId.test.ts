import { describe, expect, it } from "vitest";

import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";

describe("parseSpotifyPlaylistId", () => {
  it("accepts Spotify playlist URLs, URIs, and raw ids", () => {
    expect(parseSpotifyPlaylistId("https://open.spotify.com/playlist/5iZWReTEt9VqKeDWIHmcYi?si=abc")).toBe("5iZWReTEt9VqKeDWIHmcYi");
    expect(parseSpotifyPlaylistId("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M")).toBe("37i9dQZF1DXcBWIGoYBM5M");
    expect(parseSpotifyPlaylistId("4rnleEAOdmFAbRcNCgZMpY")).toBe("4rnleEAOdmFAbRcNCgZMpY");
  });

  it("rejects non-playlist values", () => {
    expect(parseSpotifyPlaylistId("")).toBeNull();
    expect(parseSpotifyPlaylistId("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl")).toBeNull();
    expect(parseSpotifyPlaylistId("hello world")).toBeNull();
  });
});
