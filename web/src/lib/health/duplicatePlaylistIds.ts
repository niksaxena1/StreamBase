import type { WarningRow } from "./types";

type Playlist = {
  playlist_key: string;
  display_name: string | null;
  spotify_playlist_id: string | null;
};

export function duplicatePlaylistIdWarnings(playlists: Playlist[], runDate: string): WarningRow[] {
  const groups = new Map<string, Map<string, Playlist>>();
  for (const playlist of playlists) {
    const id = playlist.spotify_playlist_id?.trim();
    if (!id) continue;
    const group = groups.get(id) ?? new Map<string, Playlist>();
    group.set(playlist.playlist_key, playlist);
    groups.set(id, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, group]) => {
    if (group.size < 2) return [];
    const rows = [...group.values()].sort((a, b) => a.playlist_key.localeCompare(b.playlist_key));
    return [{
      severity: "warn",
      code: "duplicate_spotify_playlist_id",
      playlist_key: rows[0].playlist_key,
      run_date: runDate,
      message: `${rows.map((p) => p.display_name || p.playlist_key).join(", ")} share Spotify playlist ID ${id}. Check the links in playlist settings; SOT ingestion sources are configured separately.`,
      details_json: { spotify_playlist_id: id, playlist_keys: rows.map((p) => p.playlist_key) },
    }];
  });
}
