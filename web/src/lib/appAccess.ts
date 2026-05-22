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
