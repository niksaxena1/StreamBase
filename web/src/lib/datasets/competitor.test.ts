import { describe, expect, it } from "vitest";

import { datasetSchemaForMode, navItemsForMode, navShortcutItemsForMode } from "@/lib/datasets";

describe("dataset helpers", () => {
  it("uses competitor schema in competitor mode", () => {
    expect(datasetSchemaForMode("competitor")).toBe("competitor");
  });

  it("uses public schema in own mode", () => {
    expect(datasetSchemaForMode("own")).toBe("public");
  });

  it("hides collectors in competitor mode", () => {
    const items = [
      { href: "/", label: "Home" },
      { href: "/collectors", label: "Collectors" },
    ];
    expect(navItemsForMode("competitor", items).some((i) => i.href === "/collectors")).toBe(false);
  });

  it("hides competitors in own mode", () => {
    const items = [
      { href: "/", label: "Home" },
      { href: "/competitors", label: "Competitors" },
    ];
    expect(navItemsForMode("own", items).some((i) => i.href === "/competitors")).toBe(false);
  });

  it("maps shortcut 4 to competitors in competitor mode", () => {
    const shortcuts = navShortcutItemsForMode("competitor");
    expect(shortcuts.find((s) => s.key === "4")?.href).toBe("/competitors");
    expect(shortcuts.some((s) => s.href === "/collectors")).toBe(false);
  });

  it("maps shortcut 4 to collectors in own mode", () => {
    const shortcuts = navShortcutItemsForMode("own");
    expect(shortcuts.find((s) => s.key === "4")?.href).toBe("/collectors");
    expect(shortcuts.some((s) => s.href === "/competitors")).toBe(false);
  });

  it("shows only playlist watch when that is the only app access", () => {
    const items = [
      { href: "/", label: "Home" },
      { href: "/playlists", label: "Playlists" },
      { href: "/playlist-watch", label: "Playlist Watch" },
      { href: "/health", label: "Health" },
    ];

    expect(
      navItemsForMode("own", items, {
        ownCatalog: false,
        competitor: false,
        playlistWatch: true,
        playlistWatchAdmin: false,
      }),
    ).toEqual([{ href: "/playlist-watch", label: "Playlist Watch" }]);
  });

  describe("library nav item", () => {
    const items = [
      { href: "/", label: "Home" },
      { href: "/catalog", label: "Catalog" },
      { href: "/library", label: "Library" },
      { href: "/collectors", label: "Collectors" },
      { href: "/competitors", label: "Competitors" },
    ];
    const fullAccess = { ownCatalog: true, competitor: true, playlistWatch: true, playlistWatchAdmin: true };
    const hasLibrary = (list: Array<{ href: string }>) => list.some((i) => i.href === "/library");

    it("shows library to admins in own mode", () => {
      expect(hasLibrary(navItemsForMode("own", items, fullAccess, { isAdmin: true }))).toBe(true);
    });

    it("hides library from non-admins, even with every access flag", () => {
      expect(hasLibrary(navItemsForMode("own", items, fullAccess, { isAdmin: false }))).toBe(false);
      expect(hasLibrary(navItemsForMode("own", items, fullAccess))).toBe(false);
      expect(hasLibrary(navItemsForMode("own", items))).toBe(false);
    });

    it("hides library in competitor mode, even for admins", () => {
      expect(hasLibrary(navItemsForMode("competitor", items, fullAccess, { isAdmin: true }))).toBe(false);
    });

    it("leaves the other items alone", () => {
      expect(navItemsForMode("own", items, fullAccess, { isAdmin: true }).map((i) => i.href)).toEqual([
        "/",
        "/catalog",
        "/library",
        "/collectors",
      ]);
    });

    it("never shows library to playlist-watch-only users", () => {
      const watchOnly = { ownCatalog: false, competitor: false, playlistWatch: true, playlistWatchAdmin: false };
      const withWatch = [...items, { href: "/playlist-watch", label: "Watch" }];
      expect(navItemsForMode("own", withWatch, watchOnly, { isAdmin: true })).toEqual([
        { href: "/playlist-watch", label: "Watch" },
      ]);
    });

    it("has no keyboard shortcut", () => {
      expect(navShortcutItemsForMode("own").some((s) => s.href === "/library")).toBe(false);
      expect(navShortcutItemsForMode("competitor").some((s) => s.href === "/library")).toBe(false);
    });
  });

  it("keeps playlist watch out of the main mode nav for full users", () => {
    const items = [
      { href: "/", label: "Home" },
      { href: "/playlists", label: "Playlists" },
      { href: "/playlist-watch", label: "Playlist Watch" },
      { href: "/health", label: "Health" },
    ];

    expect(
      navItemsForMode("own", items, {
        ownCatalog: true,
        competitor: true,
        playlistWatch: true,
        playlistWatchAdmin: true,
      }).some((item) => item.href === "/playlist-watch"),
    ).toBe(false);
  });
});
