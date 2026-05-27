import type { Metadata } from "next";

import { loadPlaylistsConfigPage } from "@/lib/playlists/loadPlaylistsConfigPage";

import { PlaylistsConfigClient } from "./PlaylistsConfigClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playlist Config",
};

export default async function PlaylistsConfigPage() {
  const { playlists, isAdmin, errorMessage } = await loadPlaylistsConfigPage();

  return (
    <PlaylistsConfigClient
      playlists={playlists}
      isAdmin={isAdmin}
      errorMessage={errorMessage}
    />
  );
}
