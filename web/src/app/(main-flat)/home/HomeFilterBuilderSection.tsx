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
            rows.map((r) => {
              const key = String(r?.playlist_key ?? "");
              return {
                value: key,
                label: String(r?.display_name ?? r?.playlist_key ?? ""),
                imageUrl: (r?.spotify_playlist_image_url ?? null) as string | null,
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
        const rows = Array.isArray((json as any)?.playlists)
          ? ((json as any).playlists as any[])
          : [];
        if (!cancelled) {
          setPlaylistData(
            rows.map((r) => ({
              playlist_key: String(r?.playlist_key ?? ""),
              display_name: String(r?.display_name ?? ""),
              track_count: Number(r?.track_count ?? 0),
              total_streams: Number(r?.total_streams ?? 0),
              daily_streams: r?.daily_streams != null ? Number(r.daily_streams) : null,
              is_catalog: Boolean(r?.is_catalog),
              playlist_type: (r?.playlist_type ?? null) as string | null,
              collector: (r?.collector ?? null) as string | null,
              spotify_playlist_image_url: (r?.spotify_playlist_image_url ?? null) as string | null,
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
        const url = dateScopePlaylistKey && dateScopePlaylistKey !== "all_catalog"
          ? `/api/dates/catalog-stats?playlist_key=${encodeURIComponent(dateScopePlaylistKey)}`
          : "/api/dates/catalog-stats";
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = Array.isArray((json as any)?.rows) ? ((json as any).rows as any[]) : [];
        if (!cancelled) {
          // First pass: basic fields (convert run dates to data dates)
          const base = rows.map((r) => {
            const runDate = String(r?.date ?? "");
            const dataDate = dataDateFromRunDate(runDate);
            const dayOfWeek = new Date(`${dataDate}T12:00:00Z`).getUTCDay();
            return {
              date: dataDate,
              daily_streams: Number(r?.daily_streams ?? 0),
              cumulative_streams: Number(r?.cumulative_streams ?? 0),
              track_count: Number(r?.track_count ?? 0),
              growth_pct: r?.growth_pct != null ? Number(r.growth_pct) : null,
              tracks_added: Number(r?.tracks_added ?? 0),
              day_of_week: dayOfWeek,
              est_daily_revenue: r?.est_daily_revenue != null ? Number(r.est_daily_revenue) : null,
              missing_streams_count: Number(r?.missing_streams_count ?? 0),
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
      spotify_track_id: p.spotify_track_id ?? ((p.artist_ids?.length ?? 0) > 0 ? "enriched" : null),
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
