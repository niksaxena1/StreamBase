"use client";

import { useEffect, useState } from "react";

import { fetchApiJson } from "@/lib/api";
import type { CatalogConfigArtistRpcRow, CatalogConfigTrackRpcRow, DistroPlaylist } from "@/lib/catalog/loadCatalogConfig";

import { ArtistsConfigClient } from "./ArtistsConfigClient";
import { TracksConfigClient } from "./TracksConfigClient";

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

function mapArtists(rows: CatalogConfigArtistRpcRow[]) {
  return rows.map((artist) => ({
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
}

function mapTracks(rows: CatalogConfigTrackRpcRow[]) {
  return rows.map((track) => ({
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
}

export function CatalogConfigPageClient(props: {
  artists: CatalogConfigArtistRpcRow[];
  artistsError: string | null;
}) {
  const [tracks, setTracks] = useState<CatalogConfigTrackRpcRow[]>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  const [tracksError, setTracksError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchApiJson<{ tracks: CatalogConfigTrackRpcRow[] }>("/api/catalog/config/tracks");
        if (!cancelled) {
          setTracks(data.tracks ?? []);
          setTracksError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setTracksError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setTracksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const artists = mapArtists(props.artists);
  const trackRows = mapTracks(tracks);

  return (
    <div className="space-y-4">
      {props.artistsError ? (
        <p className="text-xs text-red-600 dark:text-red-400">Artists: {props.artistsError}</p>
      ) : null}
      {tracksError ? <p className="text-xs text-red-600 dark:text-red-400">Tracks: {tracksError}</p> : null}
      <ArtistsConfigClient
        artists={artists}
        totalCount={artists.length}
        allTracks={trackRows}
        tracksLoading={tracksLoading}
      />
      <TracksConfigClient tracks={trackRows} totalCount={trackRows.length} loading={tracksLoading} />
    </div>
  );
}
