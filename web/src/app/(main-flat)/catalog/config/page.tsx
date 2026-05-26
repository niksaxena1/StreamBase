import type { Metadata } from "next";

import { supabaseService } from "@/lib/supabase/service";
import { ArtistsConfigClient } from "./ArtistsConfigClient";
import { TracksConfigClient } from "./TracksConfigClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalog Config",
};

const CATALOG_CONFIG_INITIAL_LIMIT = 1000;
const CATALOG_CONFIG_MAX_ROWS = 5000;

export type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

type CatalogConfigTrackRpcRow = {
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

type CatalogConfigArtistRpcRow = {
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

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDistroPlaylists(value: unknown): DistroPlaylist[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = typeof row.key === "string" ? row.key : "";
      const name = typeof row.name === "string" ? row.name : key;
      const imageUrl = typeof row.imageUrl === "string" ? row.imageUrl : null;
      return key ? { key, name, imageUrl } : null;
    })
    .filter((item): item is DistroPlaylist => item !== null);
}

async function fetchTrackRows(svc: ReturnType<typeof supabaseService>) {
  const rows: CatalogConfigTrackRpcRow[] = [];
  for (let offset = 0; offset < CATALOG_CONFIG_MAX_ROWS; offset += CATALOG_CONFIG_INITIAL_LIMIT) {
    const { data, error } = await svc.rpc("catalog_config_track_rows", {
      limit_rows: CATALOG_CONFIG_INITIAL_LIMIT,
      offset_rows: offset,
    });
    if (error) throw error;
    const batch = ((data ?? []) as CatalogConfigTrackRpcRow[]);
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
    const batch = ((data ?? []) as CatalogConfigArtistRpcRow[]);
    rows.push(...batch);
    if (batch.length < CATALOG_CONFIG_INITIAL_LIMIT) break;
  }
  return rows;
}

export default async function CatalogConfigPage() {
  const svc = supabaseService();

  const [artistRowsRaw, trackRowsRaw] = await Promise.all([
    fetchArtistRows(svc).catch((error) => {
      console.error("catalog_config_artist_rows failed:", error);
      return [] as CatalogConfigArtistRpcRow[];
    }),
    fetchTrackRows(svc).catch((error) => {
      console.error("catalog_config_track_rows failed:", error);
      return [] as CatalogConfigTrackRpcRow[];
    }),
  ]);

  const artists = artistRowsRaw.map((artist) => ({
    id: artist.id,
    name: artist.name ?? artist.id,
    imageUrl: artist.image_url ?? null,
    externalUrl: artist.external_url ?? `https://open.spotify.com/artist/${artist.id}`,
    totalStreams: toNumber(artist.total_streams),
    dailyStreams: toNumber(artist.daily_streams),
    trackCount: toNumber(artist.track_count) ?? 0,
    dailyTrackCount: toNumber(artist.daily_track_count) ?? 0,
    distroPlaylists: toDistroPlaylists(artist.distro_playlists),
    inHouse: Boolean(artist.in_house),
  }));

  const tracks = trackRowsRaw.map((track) => ({
    isrc: track.isrc,
    name: track.name,
    release_date: track.release_date ?? null,
    last_seen: track.last_seen ?? null,
    albumImageUrl: track.spotify_album_image_url ?? null,
    artistNames: track.spotify_artist_names ?? null,
    artistIds: track.spotify_artist_ids ?? null,
    externalUrl: track.spotify_track_id ? `https://open.spotify.com/track/${track.spotify_track_id}` : null,
    totalStreams: toNumber(track.total_streams),
    dailyStreams: toNumber(track.daily_streams),
    distroPlaylists: toDistroPlaylists(track.distro_playlists),
  }));

  return (
    <div className="space-y-4">
      <ArtistsConfigClient artists={artists} totalCount={artists.length} allTracks={tracks} />
      <TracksConfigClient tracks={tracks} totalCount={tracks.length} />
    </div>
  );
}
