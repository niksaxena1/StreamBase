export type CurrentTrackPlaylist = {
  key: string;
  name: string;
  imageUrl: string | null;
};

type PlaylistMeta = {
  playlist_key: string;
  display_name: string;
  playlist_type: string | null;
  spotify_playlist_image_url?: string | null;
};

export function buildCurrentTrackMemberships(args: {
  isrc: string;
  datasetMode: "own" | "competitor";
  playlists: PlaylistMeta[];
  memberships: Map<string, Set<string>>;
  competitorPlaylists?: CurrentTrackPlaylist[];
}): {
  distro: CurrentTrackPlaylist[];
  entity: CurrentTrackPlaylist[];
  current: CurrentTrackPlaylist[];
} {
  if (args.datasetMode === "competitor") {
    return {
      distro: [],
      entity: [],
      current: args.competitorPlaylists ?? [],
    };
  }

  const distro: CurrentTrackPlaylist[] = [];
  const entity: CurrentTrackPlaylist[] = [];

  for (const playlist of args.playlists) {
    if (!args.memberships.get(playlist.playlist_key)?.has(args.isrc)) continue;
    const item = {
      key: playlist.playlist_key,
      name: playlist.display_name,
      imageUrl: playlist.spotify_playlist_image_url ?? null,
    };
    if (playlist.playlist_type === "Distro") distro.push(item);
    if (playlist.playlist_type === "Entity") entity.push(item);
  }

  return { distro, entity, current: [] };
}
