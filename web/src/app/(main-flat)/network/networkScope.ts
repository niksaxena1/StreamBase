/**
 * URL + types for /network graph scope: single playlist, all catalog, or custom multi-playlist rules.
 */

export type NetworkCustomPlaylistMode = "any" | "all" | "none";

export type NetworkScopeState = {
  mode: "catalog" | "playlist" | "custom";
  playlistKey: string | null;
  customPlaylistKeys: string[];
  customPlaylistMode: NetworkCustomPlaylistMode;
};

export const DEFAULT_NETWORK_SCOPE: NetworkScopeState = {
  mode: "catalog",
  playlistKey: null,
  customPlaylistKeys: [],
  customPlaylistMode: "any",
};

/** DB row used elsewhere as “whole catalog”; graph catalog scope does not use this key (RPC gets no playlist). */
export const ALL_CATALOG_PLAYLIST_KEY = "all_catalog";

function normalizeCustomMode(raw: string | undefined): NetworkCustomPlaylistMode {
  const t = (raw ?? "any").trim().toLowerCase();
  if (t === "all") return "all";
  if (t === "none") return "none";
  return "any";
}

/** Parse `net_scope` / `net_pl` / `net_pl_m` / legacy `playlist` from search params. */
export function parseNetworkScope(
  sp: Record<string, string | string[] | undefined>,
  validPlaylistKeys: Set<string>,
): NetworkScopeState {
  const netScopeRaw =
    typeof sp.net_scope === "string" ? sp.net_scope.trim().toLowerCase() : "";
  const rawPlaylist = typeof sp.playlist === "string" ? sp.playlist.trim() : "";
  const netPl = typeof sp.net_pl === "string" ? sp.net_pl.trim() : "";

  const parseKeyList = (raw: string): string[] =>
    [
      ...new Set(
        raw
          .split(",")
          .map((k) => k.trim())
          .filter(
            (k) =>
              k.length > 0 &&
              validPlaylistKeys.has(k) &&
              k !== ALL_CATALOG_PLAYLIST_KEY,
          ),
      ),
    ];

  if (netScopeRaw === "custom") {
    const customPlaylistKeys = parseKeyList(netPl);
    const customPlaylistMode = normalizeCustomMode(
      typeof sp.net_pl_m === "string" ? sp.net_pl_m : undefined,
    );
    if (customPlaylistKeys.length === 0) {
      return { ...DEFAULT_NETWORK_SCOPE };
    }
    return {
      mode: "custom",
      playlistKey: null,
      customPlaylistKeys,
      customPlaylistMode,
    };
  }

  if (netScopeRaw === "catalog") {
    return { ...DEFAULT_NETWORK_SCOPE };
  }

  if (rawPlaylist === ALL_CATALOG_PLAYLIST_KEY) {
    return { ...DEFAULT_NETWORK_SCOPE };
  }

  if (netScopeRaw === "playlist" && rawPlaylist && validPlaylistKeys.has(rawPlaylist)) {
    return {
      mode: "playlist",
      playlistKey: rawPlaylist,
      customPlaylistKeys: [],
      customPlaylistMode: "any",
    };
  }

  if (rawPlaylist && validPlaylistKeys.has(rawPlaylist)) {
    return {
      mode: "playlist",
      playlistKey: rawPlaylist,
      customPlaylistKeys: [],
      customPlaylistMode: "any",
    };
  }

  return { ...DEFAULT_NETWORK_SCOPE };
}

/** Parse `hide_non_primary` search param for the collaboration graph RPC. */
export function parseHideNonPrimary(v: string | string[] | undefined): boolean {
  if (v === undefined) return false;
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes";
}

/** Write scope to URLSearchParams (clears conflicting keys first). */
export function appendNetworkScopeToSearchParams(
  p: URLSearchParams,
  scope: NetworkScopeState,
): void {
  p.delete("net_scope");
  p.delete("net_pl");
  p.delete("net_pl_m");
  p.delete("playlist");
  if (scope.mode === "catalog") return;
  if (scope.mode === "playlist" && scope.playlistKey) {
    p.set("playlist", scope.playlistKey);
    return;
  }
  if (scope.mode === "custom" && scope.customPlaylistKeys.length > 0) {
    p.set("net_scope", "custom");
    p.set("net_pl", scope.customPlaylistKeys.join(","));
    p.set("net_pl_m", scope.customPlaylistMode);
  }
}

/** Human-readable label for toolbar / export (short). */
export function formatNetworkScopeLabel(
  scope: NetworkScopeState,
  playlistNameByKey: Map<string, string>,
): string {
  if (scope.mode === "catalog") return "All Catalog";
  if (scope.mode === "playlist" && scope.playlistKey) {
    return playlistNameByKey.get(scope.playlistKey) ?? scope.playlistKey;
  }
  if (scope.mode === "custom" && scope.customPlaylistKeys.length > 0) {
    const modeWord =
      scope.customPlaylistMode === "all"
        ? "all of"
        : scope.customPlaylistMode === "none"
          ? "not in"
          : "any of";
    return `Custom (${modeWord} ${scope.customPlaylistKeys.length} playlist${scope.customPlaylistKeys.length !== 1 ? "s" : ""})`;
  }
  return "All Catalog";
}

/** Stable string for camera persistence, selection fetch keys, and graph-identity effects. */
export function networkScopeIdentity(scope: NetworkScopeState): string {
  if (scope.mode === "catalog") return "c";
  if (scope.mode === "playlist") return `p:${scope.playlistKey ?? ""}`;
  const keys = [...scope.customPlaylistKeys].sort().join(",");
  return `u:${keys}:${scope.customPlaylistMode}`;
}
