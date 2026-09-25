import { describe, expect, it } from "vitest";

import { normalizeOnboardingRequest } from "./onboarding";
import {
  normalizeAccentHex,
  parseSotDashboardUrl,
  parseSotPlaylistId,
  parseSpotifyPlaylistId,
  slugifyKey,
} from "./onboardingParsers";

describe("slugifyKey", () => {
  it("matches the keys already used in config/competitor_playlists.csv", () => {
    expect(slugifyKey("Diepgraven Records 🌴 | All Releases")).toBe("diepgraven_records_all_releases");
    expect(slugifyKey("Paraíso Releases")).toBe("paraiso_releases");
    expect(slugifyKey("Lilly Era")).toBe("lilly_era");
    expect(slugifyKey("  --  ")).toBe("");
  });
});

describe("link parsers", () => {
  it("parses Spotify playlist links, URIs and ids", () => {
    expect(parseSpotifyPlaylistId("https://open.spotify.com/playlist/07MzpeD6a32EYRKuxp60o0?si=abc")).toBe(
      "07MzpeD6a32EYRKuxp60o0",
    );
    expect(parseSpotifyPlaylistId("https://open.spotify.com/intl-de/playlist/07MzpeD6a32EYRKuxp60o0")).toBe(
      "07MzpeD6a32EYRKuxp60o0",
    );
    expect(parseSpotifyPlaylistId("spotify:playlist:07MzpeD6a32EYRKuxp60o0")).toBe("07MzpeD6a32EYRKuxp60o0");
    expect(parseSpotifyPlaylistId("07MzpeD6a32EYRKuxp60o0")).toBe("07MzpeD6a32EYRKuxp60o0");
    expect(parseSpotifyPlaylistId("https://open.spotify.com/track/3SkuTkIkeNa9l2UCexClYh")).toBeNull();
  });

  it("parses SpotOnTrack playlist and dashboard links", () => {
    expect(parseSotPlaylistId("https://www.spotontrack.com/playlists/spotify/4704229")).toBe(4704229);
    expect(parseSotPlaylistId("4704229")).toBe(4704229);
    expect(parseSotPlaylistId("https://www.spotontrack.com/dashboard/12262")).toBeNull();
    expect(parseSotDashboardUrl("spotontrack.com/dashboard/12262/")).toBe("https://www.spotontrack.com/dashboard/12262");
    expect(parseSotDashboardUrl("https://www.spotontrack.com/dashboard/12262?tab=tracks")).toBe(
      "https://www.spotontrack.com/dashboard/12262",
    );
    expect(parseSotDashboardUrl("https://example.com/dashboard/1")).toBeNull();
  });

  it("normalizes accent hex to 6 uppercase chars without #", () => {
    expect(normalizeAccentHex("#ff6b35")).toBe("FF6B35");
    expect(normalizeAccentHex("")).toBeNull();
    expect(normalizeAccentHex("#fff")).toBeNull();
  });
});

const validPlaylist = {
  display_name: "Diepgraven Records 🌴 | All Releases",
  spotify_playlist: "https://open.spotify.com/playlist/07MzpeD6a32EYRKuxp60o0",
  sot_playlist: "https://www.spotontrack.com/playlists/spotify/4704229",
  sot_dashboard_url: "https://www.spotontrack.com/dashboard/12262",
};

describe("normalizeOnboardingRequest", () => {
  it("derives keys and defaults for a new label", () => {
    const res = normalizeOnboardingRequest({
      label: { mode: "new", display_name: "Diepgraven", accent_hex: "#1f8a70" },
      playlist: validPlaylist,
    });
    expect(res).toEqual({
      ok: true,
      value: {
        label: { mode: "new", label_key: "diepgraven", display_name: "Diepgraven", accent_hex: "1F8A70" },
        playlist: {
          playlist_key: "diepgraven_records_all_releases",
          label_key: "diepgraven",
          display_name: "Diepgraven Records 🌴 | All Releases",
          spotify_playlist_id: "07MzpeD6a32EYRKuxp60o0",
          sot_playlist_id: 4704229,
          sot_dashboard_url: "https://www.spotontrack.com/dashboard/12262",
          sot_dashboard_name: "Diepgraven Records 🌴 | All Releases",
          min_rows: 1,
        },
      },
    });
  });

  it("attaches a playlist to an existing label", () => {
    const res = normalizeOnboardingRequest({
      label: { mode: "existing", label_key: "soave" },
      playlist: { ...validPlaylist, display_name: "Soave Chill", sot_dashboard_name: "soave chill", min_rows: 5 },
    });
    expect(res.ok && res.value.playlist).toMatchObject({
      playlist_key: "soave_chill",
      label_key: "soave",
      sot_dashboard_name: "soave chill",
      min_rows: 5,
    });
  });

  it("reports field-level errors", () => {
    const res = normalizeOnboardingRequest({
      label: { mode: "new", display_name: "🌴", accent_hex: "blue" },
      playlist: { ...validPlaylist, spotify_playlist: "nope", sot_dashboard_url: "https://www.spotontrack.com/x" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.errors).sort()).toEqual([
      "label.accent_hex",
      "label.label_key",
      "playlist.sot_dashboard_url",
      "playlist.spotify_playlist",
    ]);
  });

  it("rejects unknown fields and missing sections", () => {
    expect(normalizeOnboardingRequest({ label: { mode: "existing", label_key: "x" } }).ok).toBe(false);
    expect(
      normalizeOnboardingRequest({ label: { mode: "existing", label_key: "x" }, playlist: validPlaylist, extra: 1 }).ok,
    ).toBe(false);
  });
});
