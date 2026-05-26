export type AppAccess = {
  ownCatalog: boolean;
  competitor: boolean;
  playlistWatch: boolean;
  playlistWatchAdmin: boolean;
};

export type AppAccessRow = {
  own_catalog?: boolean | null;
  competitor?: boolean | null;
  playlist_watch?: boolean | null;
  playlist_watch_admin?: boolean | null;
} | null;

export const DEFAULT_ADMIN_APP_ACCESS: AppAccess = {
  ownCatalog: true,
  competitor: true,
  playlistWatch: true,
  playlistWatchAdmin: true,
};

export function normalizeAppAccess(row: AppAccessRow, isAdmin: boolean): AppAccess {
  if (isAdmin) return DEFAULT_ADMIN_APP_ACCESS;
  return {
    ownCatalog: Boolean(row?.own_catalog),
    competitor: Boolean(row?.competitor),
    playlistWatch: Boolean(row?.playlist_watch),
    playlistWatchAdmin: Boolean(row?.playlist_watch_admin),
  };
}

/** Own-catalog and/or competitor analytics (full StreamBase app). Admins always qualify via `normalizeAppAccess`. */
export function hasStreamBaseAccess(access: AppAccess) {
  return access.ownCatalog || access.competitor;
}

export function isPlaylistWatchOnlyAccess(access: AppAccess) {
  return access.playlistWatch && !hasStreamBaseAccess(access);
}

/** Where to send users who lack StreamBase access (playlist-watch landing or login). */
export function streamBaseAccessRedirectPath(access: AppAccess): string | null {
  if (hasStreamBaseAccess(access)) return null;
  if (access.playlistWatch) return "/playlist-watch";
  return "/login";
}
