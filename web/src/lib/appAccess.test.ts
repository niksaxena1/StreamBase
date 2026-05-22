import { describe, expect, it } from "vitest";

import { normalizeAppAccess } from "@/lib/appAccess";

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
});
