import type { CurrentTrackPlaylist } from "./trackMemberships";

export function buildFilterCsvRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    if (Array.isArray(out.spotify_artist_names)) {
      out.artists = (out.spotify_artist_names as string[]).join(" | ");
      delete out.spotify_artist_names;
    }
    if (Array.isArray(out.spotify_artist_ids)) {
      out.artist_ids = (out.spotify_artist_ids as string[]).join(" | ");
      delete out.spotify_artist_ids;
    }
    for (const key of ["current_distro_playlists", "current_entity_playlists", "current_playlists"]) {
      if (Array.isArray(out[key])) {
        out[key] = (out[key] as CurrentTrackPlaylist[]).map((playlist) => playlist.name).join(" | ");
      }
    }
    return out;
  });
}
