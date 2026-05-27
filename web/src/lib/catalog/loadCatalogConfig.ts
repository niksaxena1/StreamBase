import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQueries, cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";

const CATALOG_CONFIG_INITIAL_LIMIT = 1000;
const CATALOG_CONFIG_MAX_ROWS = 5000;

export type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

export type CatalogConfigTrackRpcRow = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  last_seen: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_artist_ids: string[] | null;
  spotify_track_id: string | null;
  total_streams: number | string | null;
  daily_streams: number | string | null;
  distro_playlists: DistroPlaylist[] | null;
};

export type CatalogConfigArtistRpcRow = {
  id: string;
  name: string | null;
  image_url: string | null;
  external_url: string | null;
  total_streams: number | string | null;
  daily_streams: number | string | null;
  track_count: number | string | null;
  daily_track_count: number | string | null;
  distro_playlists: DistroPlaylist[] | null;
  in_house: boolean | null;
};

async function fetchTrackRows(svc: ReturnType<typeof supabaseService>) {
  const rows: CatalogConfigTrackRpcRow[] = [];
  for (let offset = 0; offset < CATALOG_CONFIG_MAX_ROWS; offset += CATALOG_CONFIG_INITIAL_LIMIT) {
    const { data, error } = await svc.rpc("catalog_config_track_rows", {
      limit_rows: CATALOG_CONFIG_INITIAL_LIMIT,
      offset_rows: offset,
    });
    if (error) throw error;
    const batch = (data ?? []) as CatalogConfigTrackRpcRow[];
    rows.push(...batch);
    if (batch.length < CATALOG_CONFIG_INITIAL_LIMIT) break;
  }
  return rows;
}

async function fetchArtistRows(svc: ReturnType<typeof supabaseService>) {
  const rows: CatalogConfigArtistRpcRow[] = [];
  for (let offset = 0; offset < CATALOG_CONFIG_MAX_ROWS; offset += CATALOG_CONFIG_INITIAL_LIMIT) {
    const { data, error } = await svc.rpc("catalog_config_artist_rows", {
      track_limit_rows: CATALOG_CONFIG_MAX_ROWS,
      result_limit_rows: CATALOG_CONFIG_INITIAL_LIMIT,
      result_offset_rows: offset,
    });
    if (error) throw error;
    const batch = (data ?? []) as CatalogConfigArtistRpcRow[];
    rows.push(...batch);
    if (batch.length < CATALOG_CONFIG_INITIAL_LIMIT) break;
  }
  return rows;
}

export async function loadCatalogConfigArtists(): Promise<{
  artists: CatalogConfigArtistRpcRow[];
  errorMessage: string | null;
}> {
  const svc = supabaseService();
  const cached = await cachedQueries(
    {
      artists: async () => {
        try {
          const rows = await fetchArtistRows(svc);
          return { data: rows, error: null };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { data: [] as CatalogConfigArtistRpcRow[], error: { message } };
        }
      },
    },
    "catalog-config-artists",
    CACHE_TTL_1H,
  );

  return {
    artists: (cached.artists.data ?? []) as CatalogConfigArtistRpcRow[],
    errorMessage: cached.artists.error?.message ?? null,
  };
}

export async function loadCatalogConfigTracks(): Promise<{
  tracks: CatalogConfigTrackRpcRow[];
  errorMessage: string | null;
}> {
  const svc = supabaseService();
  const cached = await cachedQuery(
    async () => {
      try {
        const rows = await fetchTrackRows(svc);
        return { data: rows, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { data: [] as CatalogConfigTrackRpcRow[], error: { message } };
      }
    },
    "catalog-config-tracks",
    CACHE_TTL_1H,
  );
  return {
    tracks: (cached.data ?? []) as CatalogConfigTrackRpcRow[],
    errorMessage: cached.error?.message ?? null,
  };
}

