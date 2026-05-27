import type { Metadata } from "next";
import nextDynamic from "next/dynamic";

import { Alert } from "@/components/ui/Alert";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { loadPlaylistsSettingsPage } from "@/lib/playlists/loadPlaylistsSettingsPage";

import {
  reorderPlaylists,
  updateCollector,
  updateEntityPlaylist,
  updatePlaylist,
  updatePlaylistType,
} from "./playlistSettingsActions";
import { RefreshSpotifyThumbnailsButton } from "./RefreshSpotifyThumbnailsButton";

const PlaylistSettingsTable = nextDynamic(
  () => import("./PlaylistSettingsTable").then((m) => ({ default: m.PlaylistSettingsTable })),
  { loading: () => <TableSkeleton rows={10} cols={6} /> },
);

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playlist Settings",
};

export default async function PlaylistSettingsPage() {
  const { playlists, errorMessage } = await loadPlaylistsSettingsPage();

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Playlist Settings
          </h1>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Paste a Spotify playlist URL/URI/ID to enable playlist thumbnails in StreamBase.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshSpotifyThumbnailsButton />
        </div>
      </div>

      {errorMessage ? (
        <Alert variant="error" title="Query error">
          {errorMessage}
        </Alert>
      ) : null}

      <PlaylistSettingsTable
        playlists={playlists}
        updatePlaylist={updatePlaylist}
        updateCollector={updateCollector}
        updatePlaylistType={updatePlaylistType}
        updateEntityPlaylist={updateEntityPlaylist}
        reorderPlaylists={reorderPlaylists}
      />
    </div>
  );
}
