"use client";

import { useEffect, useMemo, useState } from "react";

import { type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { FilterBuilder, type TrackDataPoint, type PlaylistDataPoint, type DateDataPoint } from "@/components/filters";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";

export function HomeFilterBuilderSection({
  trackScatterPoints,
  trackScatterDataDate,
}: {
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterDataDate: string | null;
}) {
  const [playlistOptions, setPlaylistOptions] = useState<
    Array<{ value: string; label: string; imageUrl?: string | null; isAllCatalog?: boolean }>
  >([]);
  const [playlistData, setPlaylistData] = useState<PlaylistDataPoint[]>([]);
  const [dateData, setDateData] = useState<DateDataPoint[]>([]);
  const [dateScopePlaylistKey, setDateScopePlaylistKey] = useState("all_catalog");
  const [artistImagesById, setArtistImagesById] = useState<Map<string, string | null>>(new Map());
  const [trackDatesMap, setTrackDatesMap] = useState<Map<string, { first_seen: string | null; last_seen: string | null }>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/playlists/options");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const rows = Array.isArray(obj?.playlists) ? (obj.playlists as unknown[]) : [];
        if (!cancelled) {
          setPlaylistOptions(
            rows.map((r) => {
              const row = r as Record<string, unknown>;
              const key = String(row?.playlist_key ?? "");
              return {
                value: key,
                label: String(row?.display_name ?? row?.playlist_key ?? ""),
                imageUrl: (row?.spotify_playlist_image_url ?? null) as string | null,
                isAllCatalog: key === "all_catalog",
              };
            }),
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
        const res = await fetch("/api/playlists/with-stats");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const rows = Array.isArray(obj?.playlists) ? (obj.playlists as unknown[]) : [];
        if (!cancelled) {
          setPlaylistData(
            rows.map((r) => {
              const row = r as Record<string, unknown>;
              return {
                playlist_key: String(row?.playlist_key ?? ""),
                display_name: String(row?.display_name ?? ""),
                track_count: Number(row?.track_count ?? 0),
                total_streams: Number(row?.total_streams ?? 0),
                daily_streams: row?.daily_streams != null ? Number(row.daily_streams) : null,
                is_catalog: Boolean(row?.is_catalog),
                playlist_type: (row?.playlist_type ?? null) as string | null,
                collector: (row?.collector ?? null) as string | null,
                spotify_playlist_image_url: (row?.spotify_playlist_image_url ?? null) as string | null,
              };
            }),
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
        const url = dateScopePlaylistKey && dateScopePlaylistKey !== "all_catalog"
          ? `/api/dates/catalog-stats?playlist_key=${encodeURIComponent(dateScopePlaylistKey)}`
          : "/api/dates/catalog-stats";
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const rows = Array.isArray(obj?.rows) ? (obj.rows as unknown[]) : [];
        if (!cancelled) {
          // First pass: basic fields (convert run dates to data dates)
          const base = rows.map((r) => {
            const row = r as Record<string, unknown>;
            const runDate = String(row?.date ?? "");
            const dataDate = dataDateFromRunDate(runDate);
            const dayOfWeek = new Date(`${dataDate}T12:00:00Z`).getUTCDay();
            return {
              date: dataDate,
              daily_streams: Number(row?.daily_streams ?? 0),
              cumulative_streams: Number(row?.cumulative_streams ?? 0),
              track_count: Number(row?.track_count ?? 0),
              growth_pct: row?.growth_pct != null ? Number(row.growth_pct) : null,
              tracks_added: Number(row?.tracks_added ?? 0),
              day_of_week: dayOfWeek,
              est_daily_revenue: row?.est_daily_revenue != null ? Number(row.est_daily_revenue) : null,
              missing_streams_count: Number(row?.missing_streams_count ?? 0),
            };
          });

          // Second pass: derived statistical fields
          setDateData(
            base.map((row, idx) => {
              const tc = row.track_count;
              const streamsPerTrack = tc > 0 ? row.daily_streams / tc : null;
              const isWeekend = row.day_of_week === 0 || row.day_of_week === 6;

              // 7-day moving average (centered on current day, using up to 7 trailing days)
              let movingAvg: number | null = null;
              if (idx >= 6) {
                let sum = 0;
                for (let j = idx - 6; j <= idx; j++) sum += base[j].daily_streams;
                movingAvg = Math.round((sum / 7) * 100) / 100;
              }

              // Week-over-week growth % (compare to same day 7 days ago)
              let wowGrowth: number | null = null;
              if (idx >= 7) {
                const prev7 = base[idx - 7].daily_streams;
                if (prev7 > 0) {
                  wowGrowth = Math.round(((row.daily_streams - prev7) / prev7) * 10000) / 100;
                }
              }

              return {
                ...row,
                streams_per_track: streamsPerTrack != null ? Math.round(streamsPerTrack * 100) / 100 : null,
                is_weekend: isWeekend,
                moving_avg_7d: movingAvg,
                wow_growth_pct: wowGrowth,
              };
            }),
          );
        }
      } catch {
        // ignore
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [dateScopePlaylistKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/tracks/dates");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const rows = Array.isArray(obj?.rows) ? (obj.rows as unknown[]) : [];
        const map = new Map<string, { first_seen: string | null; last_seen: string | null }>();
        for (const r of rows) {
          const row = r as Record<string, unknown>;
          const isrc = String(row?.isrc ?? "");
          if (!isrc) continue;
          map.set(isrc, {
            first_seen: (row?.first_seen ?? null) as string | null,
            last_seen: (row?.last_seen ?? null) as string | null,
          });
        }
        if (!cancelled) setTrackDatesMap(map);
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
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        const rows = Array.isArray(obj?.artists) ? (obj.artists as unknown[]) : [];
        const map = new Map<string, string | null>();
        for (const r of rows) {
          const row = r as Record<string, unknown>;
          const id = String(row?.artist_id ?? "");
          if (!id) continue;
          map.set(id, (row?.image_url ?? null) as string | null);
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
    return (trackScatterPoints ?? []).map((p) => {
      const dates = trackDatesMap.get(p.isrc);
      return {
        isrc: p.isrc,
        name: p.name ?? "",
        release_date: p?.release_date ?? null,
        first_seen: dates?.first_seen ?? null,
        last_seen: dates?.last_seen ?? null,
        spotify_artist_names: p.artist_names ?? [],
        spotify_artist_ids: p.artist_ids ?? [],
        total_streams_cumulative: p.total_streams_cumulative,
        daily_streams: p.daily_streams_delta,
        spotify_track_id: p.spotify_track_id ?? ((p.artist_ids?.length ?? 0) > 0 ? "enriched" : null),
        spotify_album_image_url: p.album_image_url,
        playlist_keys: [],
      };
    });
  }, [trackScatterPoints, trackDatesMap]);

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

  const asOfRunDate = useMemo(() => {
    if (!trackScatterDataDate) return null;
    return addDaysISO(trackScatterDataDate, SOT_DATA_LAG_DAYS);
  }, [trackScatterDataDate]);

  return (
    <FilterBuilder
      trackData={trackData}
      playlistData={playlistData}
      dateData={dateData}
      dateScopePlaylistKey={dateScopePlaylistKey}
      onDateScopeChange={setDateScopePlaylistKey}
      artistImages={artistImages}
      artistOptions={artistOptions}
      playlistOptions={playlistOptions}
      asOfRunDate={asOfRunDate}
    />
  );
}
