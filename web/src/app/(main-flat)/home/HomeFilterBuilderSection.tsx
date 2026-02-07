"use client";

import { useEffect, useMemo, useState } from "react";

import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { FilterBuilder, type TrackDataPoint, type PlaylistDataPoint } from "@/components/filters";
import { addDaysISO, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";

export function HomeFilterBuilderSection({
  trackScatterPoints,
  trackScatterDataDate,
}: {
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterDataDate: string | null;
}) {
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const [playlistOptions, setPlaylistOptions] = useState<
    Array<{ value: string; label: string; imageUrl?: string | null }>
  >([]);
  const [artistImagesById, setArtistImagesById] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/playlists/options");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = Array.isArray((json as any)?.playlists) ? ((json as any).playlists as any[]) : [];
        if (!cancelled) {
          setPlaylistOptions(
            rows.map((r) => ({
              value: String(r?.playlist_key ?? ""),
              label: String(r?.display_name ?? r?.playlist_key ?? ""),
              imageUrl: (r?.spotify_image_url ?? null) as string | null,
            })),
          );
        }
      } catch {
        // ignore
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/artists/options");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = Array.isArray((json as any)?.artists) ? ((json as any).artists as any[]) : [];
        const map = new Map<string, string | null>();
        for (const r of rows) {
          const id = String(r?.artist_id ?? "");
          if (!id) continue;
          map.set(id, (r?.image_url ?? null) as string | null);
        }
        if (!cancelled) setArtistImagesById(map);
      } catch {
        // ignore
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Transform trackScatterPoints to TrackDataPoint format for FilterBuilder
  const trackData: TrackDataPoint[] = useMemo(() => {
    return (trackScatterPoints ?? []).map((p) => ({
      isrc: p.isrc,
      name: p.name ?? "",
      release_date: (p as any)?.release_date ?? null,
      first_seen: null,
      spotify_artist_names: p.artist_names ?? [],
      spotify_artist_ids: p.artist_ids ?? [],
      total_streams_cumulative: p.total_streams_cumulative,
      daily_streams: p.daily_streams_delta,
      spotify_track_id: null,
      spotify_album_image_url: p.album_image_url,
      playlist_keys: [],
    }));
  }, [trackScatterPoints]);

  // Extract unique artists from tracks for the artist selector
  const artistOptions = useMemo(() => {
    const artistMap = new Map<string, { name: string; imageUrl: string | null; trackCount: number }>();

    for (const track of trackScatterPoints ?? []) {
      const ids = track.artist_ids ?? [];
      const names = track.artist_names ?? [];

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const name = names[i] ?? "Unknown";
        if (!id) continue;

        const existing = artistMap.get(id);
        if (existing) {
          existing.trackCount++;
        } else {
          artistMap.set(id, { name, imageUrl: null, trackCount: 1 });
        }
      }
    }

    return Array.from(artistMap.entries())
      .map(([value, data]) => ({
        value,
        label: data.name,
        imageUrl: artistImagesById.get(value) ?? data.imageUrl,
        trackCount: data.trackCount,
      }))
      .sort((a, b) => b.trackCount - a.trackCount);
  }, [trackScatterPoints, artistImagesById]);

  // Build artist images map for aggregation
  const artistImages = useMemo(() => {
    const map = new Map<string, { name: string; image_url: string | null }>();
    for (const opt of artistOptions) {
      map.set(opt.value, { name: opt.label, image_url: opt.imageUrl });
    }
    return map;
  }, [artistOptions]);

  const playlistData: PlaylistDataPoint[] = useMemo(() => [], []);
  const asOfRunDate = useMemo(() => {
    if (!trackScatterDataDate) return null;
    return addDaysISO(trackScatterDataDate, SOT_DATA_LAG_DAYS);
  }, [trackScatterDataDate]);

  return (
    <FilterBuilder
      trackData={trackData}
      playlistData={playlistData}
      artistImages={artistImages}
      artistOptions={artistOptions}
      playlistOptions={playlistOptions}
      collectorOptions={[]}
      asOfRunDate={asOfRunDate}
    />
  );
}
