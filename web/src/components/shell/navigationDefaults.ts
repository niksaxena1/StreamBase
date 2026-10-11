import type { DatasetMode } from "@/lib/datasetMode";

export type NavigationDefaults = {
  datasetMode: DatasetMode;
  competitorLabelKey?: string | null;
  playlistKeys?: string[];
};

/** Competitor keys are ordered and restricted to the selected label by the server. */
export function defaultPlaylistKey(defaults: NavigationDefaults, remembered?: string | null): string {
  const key = remembered?.trim();
  if (defaults.datasetMode === "own") return key || "all_catalog";
  const keys = defaults.playlistKeys ?? [];
  return key && keys.includes(key) ? key : keys[0] ?? "";
}

export function navigationEntryHref(
  href: string,
  defaults: NavigationDefaults,
  rememberedPlaylist?: string | null,
  rememberedArtist?: string | null,
): string {
  if (href === "/playlists") {
    const key = defaultPlaylistKey(defaults, rememberedPlaylist);
    return key ? `/playlists?${new URLSearchParams({ playlist_key: key })}` : href;
  }
  if (href === "/catalog" && rememberedArtist?.trim()) {
    return `/catalog?${new URLSearchParams({ artist_id: rememberedArtist.trim() })}`;
  }
  return href;
}
