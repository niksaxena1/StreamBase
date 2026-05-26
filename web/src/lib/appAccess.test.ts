import { describe, expect, it } from "vitest";

import { hasStreamBaseAccess, isPlaylistWatchOnlyAccess, normalizeAppAccess, streamBaseAccessRedirectPath } from "@/lib/appAccess";

describe("normalizeAppAccess", () => {
  it("lets admins use all app areas", () => {
    expect(normalizeAppAccess(null, true)).toEqual({
      ownCatalog: true,
      competitor: true,
      playlistWatch: true,
      playlistWatchAdmin: true,
    });
  });

  it("uses explicit playlist watch access for non-admin users", () => {
    expect(
      normalizeAppAccess(
        {
          own_catalog: false,
          competitor: false,
          playlist_watch: true,
          playlist_watch_admin: false,
        },
        false,
      ),
    ).toEqual({
      ownCatalog: false,
      competitor: false,
      playlistWatch: true,
      playlistWatchAdmin: false,
    });
  });

  it("detects StreamBase access from catalog/competitor flags", () => {
    expect(
      hasStreamBaseAccess({
        ownCatalog: false,
        competitor: false,
        playlistWatch: true,
        playlistWatchAdmin: true,
      }),
    ).toBe(false);

    expect(
      hasStreamBaseAccess({
        ownCatalog: true,
        competitor: false,
        playlistWatch: false,
        playlistWatchAdmin: false,
      }),
    ).toBe(true);
  });

  it("redirects non-StreamBase users to playlist watch or login", () => {
    expect(
      streamBaseAccessRedirectPath({
        ownCatalog: false,
        competitor: false,
        playlistWatch: true,
        playlistWatchAdmin: true,
      }),
    ).toBe("/playlist-watch");

    expect(
      streamBaseAccessRedirectPath({
        ownCatalog: false,
        competitor: false,
        playlistWatch: false,
        playlistWatchAdmin: false,
      }),
    ).toBe("/login");
  });

  it("identifies watch-only access", () => {
    expect(
      isPlaylistWatchOnlyAccess({
        ownCatalog: false,
        competitor: false,
        playlistWatch: true,
        playlistWatchAdmin: false,
      }),
    ).toBe(true);

    expect(
      isPlaylistWatchOnlyAccess({
        ownCatalog: true,
        competitor: true,
        playlistWatch: true,
        playlistWatchAdmin: true,
      }),
    ).toBe(false);
  });
});
