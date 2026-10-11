"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { lastArtistIdStorageKey, lastPlaylistKeyStorageKey, readDatasetSelectionStorage } from "@/lib/datasetSelectionStorage";
import { navigationEntryHref, type NavigationDefaults } from "./navigationDefaults";

export function useNavigationEntries(defaults: NavigationDefaults) {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const [remembered, setRemembered] = useState<{ scope: string; playlist: string | null; artist: string | null } | null>(null);
  const scope = `${defaults.datasetMode}:${defaults.competitorLabelKey ?? ""}`;
  useEffect(() => {
    const read = (key: string, legacy: string) => {
      if (defaults.datasetMode === "own") return readDatasetSelectionStorage(key, legacy);
      try { return localStorage.getItem(key); } catch { return null; }
    };
    setRemembered({
      scope,
      playlist: read(lastPlaylistKeyStorageKey(defaults.datasetMode), "sb:last_playlist_key"),
      artist: read(lastArtistIdStorageKey(defaults.datasetMode), "sb:last_artist_id"),
    });
  }, [defaults.datasetMode, pathname, search, scope]);
  const selected = remembered?.scope === scope ? remembered : null;
  // Dashboard effects write storage after shell effects. Prefer the current URL
  // on these routes so the active rail link cannot point at a previous selection.
  const playlist = pathname === "/playlists" ? params.get("playlist_key") || selected?.playlist : selected?.playlist;
  const artist = pathname === "/catalog" ? params.get("artist_id") || selected?.artist : selected?.artist;
  return (href: string) => navigationEntryHref(href, defaults, playlist, artist);
}
