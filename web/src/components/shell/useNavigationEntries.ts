"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { lastPlaylistKeyStorageKey, readDatasetSelectionStorage } from "@/lib/datasetSelectionStorage";
import { navigationEntryHref, type NavigationDefaults } from "./navigationDefaults";

export function useNavigationEntries(defaults: NavigationDefaults) {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const [remembered, setRemembered] = useState<{ scope: string; playlist: string | null } | null>(null);
  const scope = `${defaults.datasetMode}:${defaults.competitorLabelKey ?? ""}`;
  useEffect(() => {
    const read = (key: string, legacy: string) => {
      if (defaults.datasetMode === "own") return readDatasetSelectionStorage(key, legacy);
      try { return localStorage.getItem(key); } catch { return null; }
    };
    setRemembered({
      scope,
      playlist: read(lastPlaylistKeyStorageKey(defaults.datasetMode), "sb:last_playlist_key"),
    });
  }, [defaults.datasetMode, pathname, search, scope]);
  const selected = remembered?.scope === scope ? remembered : null;
  // Dashboard effects write storage after shell effects. Prefer the current URL
  // on these routes so the active rail link cannot point at a previous selection.
  const playlist = pathname === "/playlists" ? params.get("playlist_key") || selected?.playlist : selected?.playlist;
  // Bare catalog entries restore validated memory in the page, including before shell mount.
  const artist = pathname === "/catalog" ? params.get("artist_id") : null;
  return (href: string) => navigationEntryHref(href, defaults, playlist, artist);
}
