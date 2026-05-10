import type { Metadata } from "next";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getArtistsCached } from "@/lib/spotify";
import { ArtistsConfigClient } from "./ArtistsConfigClient";
import { TracksConfigClient } from "./TracksConfigClient";

export const revalidate = 86400; // 24h ISR - catalog config uses daily snapshots

export const metadata: Metadata = {
  title: "Catalog Config",
};

export type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

type TrackDailyRow = {
  date: string;
  isrc: string;
  streams_cumulative: number | null;
};

function deriveArtists(rows: { spotify_artist_ids: string[] | null; spotify_artist_names: string[] | null }[]) {
  const byId = new Map<string, string>();
  for (const t of rows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      const id = ids[i];
      const name = names[i];
      if (!id || !name) continue;
      if (!byId.has(id)) byId.set(id, name);
    }
  }
  return Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Fetch the latest two days of track streams for daily calculation
async function fetchTrackDailyStreams(
  svc: ReturnType<typeof supabaseService>,
  days = 2,
): Promise<TrackDailyRow[]> {
  const pageSize = 1000;
  const out: TrackDailyRow[] = [];
  let from = 0;

  // Fetch latest N days of data
  while (from < 50000) {
    const to = from + pageSize - 1;
    const { data, error } = await svc
      .from("track_daily_streams_effective_public")
      .select("date,isrc,streams_cumulative")
      .order("date", { ascending: false })
      .order("isrc", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Error fetching track daily streams:", error);
      break;
    }

    const rows = (data ?? []) as TrackDailyRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

async function fetchAllTracksForTable(
  sb: Awaited<ReturnType<typeof supabaseServer>>,
  maxRows = 5000,
) {
  const pageSize = 1000;
  const out: Array<{
    isrc: string;
    name: string | null;
    release_date: string | null;
    last_seen: string | null;
    spotify_album_image_url: string | null;
    spotify_artist_names: string[] | null;
    spotify_artist_ids: string[] | null;
    spotify_track_id: string | null;
  }> = [];
  let from = 0;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from("tracks")
      .select("isrc,name,release_date,last_seen,spotify_album_image_url,spotify_artist_names,spotify_artist_ids,spotify_track_id")
      .order("last_seen", { ascending: false })
      .order("isrc", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Error fetching tracks:", error);
      break;
    }

    const rows = data ?? [];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

export default async function CatalogConfigPage() {
  const sb = await supabaseServer();
  const svc = supabaseService();

  // Fetch tracks and daily streams in parallel (independent queries)
  const [trackRows, trackDailyStreams] = await Promise.all([
    fetchAllTracksForTable(sb, 5000),
    fetchTrackDailyStreams(svc, 2),
  ]);

  // Derive unique artists from the tracks we already fetched
  const artists = deriveArtists(trackRows);

  // Fetch artist data using DB-cached Spotify lookups (avoids live API round-trips)
  const artistIds = artists.map((a) => a.id);
  const artistDataMap = await getArtistsCached(svc, artistIds);

  // Prepare artist data with images and external URLs
  const artistsWithData = artists.map((artist) => {
    const artistData = artistDataMap.get(artist.id);
    return {
      id: artist.id,
      name: artist.name,
      imageUrl: artistData?.imageUrl ?? null,
      externalUrl: artistData?.externalUrl ?? `https://open.spotify.com/artist/${artist.id}`,
    };
  });
  
  // Group by date to get latest two dates
  const streamsByDate = new Map<string, Map<string, number>>();
  for (const row of trackDailyStreams) {
    if (!streamsByDate.has(row.date)) {
      streamsByDate.set(row.date, new Map());
    }
    if (row.streams_cumulative !== null) {
      streamsByDate.get(row.date)!.set(row.isrc, row.streams_cumulative);
    }
  }
  
  const dates = Array.from(streamsByDate.keys()).sort().reverse();
  const latestDate = dates[0];
  const previousDate = dates[1];
  
  const latestStreams = streamsByDate.get(latestDate) ?? new Map();
  const previousStreams = streamsByDate.get(previousDate) ?? new Map();

  // Calculate track stats
  type TrackStats = {
    totalStreams: number | null;
    dailyStreams: number | null;
  };
  
  const trackStats = new Map<string, TrackStats>();
  for (const track of trackRows) {
    const total = latestStreams.get(track.isrc) ?? null;
    const prev = previousStreams.get(track.isrc) ?? null;
    
    let daily: number | null = null;
    if (total !== null && prev !== null) {
      daily = Math.max(0, total - prev);
    }
    
    trackStats.set(track.isrc, {
      totalStreams: total,
      dailyStreams: daily,
    });
  }

  // Calculate artist stats
  type ArtistStats = {
    totalStreams: number | null;
    dailyStreams: number | null;
    trackCount: number;
    dailyTrackCount: number;
  };
  
  const artistStats = new Map<string, ArtistStats>();
  for (const artist of artists) {
    let artistTotalStreams = 0;
    let artistDailyStreams = 0;
    let hasTotalStats = false;
    let hasDailyStats = false;
    let trackCount = 0;
    
    // Track ISRCs seen on each date for daily track count
    const isrcsOnLatestDate = new Set<string>();
    const isrcsOnPreviousDate = new Set<string>();
    
    // Find all tracks for this artist and sum their stats
    for (const track of trackRows) {
      if (track.spotify_artist_ids?.includes(artist.id)) {
        trackCount += 1;
        
        const stats = trackStats.get(track.isrc);
        if (stats && stats.totalStreams !== null) {
          artistTotalStreams += stats.totalStreams;
          hasTotalStats = true;
        }
        if (stats && stats.dailyStreams !== null) {
          artistDailyStreams += stats.dailyStreams;
          hasDailyStats = true;
        }
        
        // Check if track appears in latest/previous dates
        if (latestStreams.has(track.isrc)) {
          isrcsOnLatestDate.add(track.isrc);
        }
        if (previousStreams.has(track.isrc)) {
          isrcsOnPreviousDate.add(track.isrc);
        }
      }
    }
    
    // Daily track count is new tracks (in latest but not in previous)
    const dailyTrackCount = Array.from(isrcsOnLatestDate).filter(
      (isrc) => !isrcsOnPreviousDate.has(isrc)
    ).length;
    
    artistStats.set(artist.id, {
      totalStreams: hasTotalStats ? artistTotalStreams : null,
      dailyStreams: hasDailyStats ? artistDailyStreams : null,
      trackCount,
      dailyTrackCount,
    });
  }

  // Fetch distro playlists and their currently-active memberships.
  // Strategy: query the small set of distro playlists first, then paginate memberships scoped to those keys.
  // Use today's date (not latestDate) so newly-added memberships aren't missed.
  const todayDate = new Date().toISOString().slice(0, 10);
  const isrcDistroMap = new Map<string, DistroPlaylist[]>();
  const artistDistroMap = new Map<string, DistroPlaylist[]>();

  const { data: distroPlaylistRows } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .eq("playlist_type", "Distro");

  const distroPlaylists = ((distroPlaylistRows ?? []) as Array<{
    playlist_key: string;
    display_name: string | null;
    spotify_playlist_image_url: string | null;
  }>).map((p) => ({
    key: p.playlist_key,
    name: p.display_name ?? p.playlist_key,
    imageUrl: p.spotify_playlist_image_url ?? null,
  }));

  if (distroPlaylists.length) {
    const distroKeys = distroPlaylists.map((p) => p.key);
    const distroInfoByKey = new Map(distroPlaylists.map((p) => [p.key, p]));

    // Paginate to avoid the Supabase 1000-row limit silently truncating results.
    const allMembershipRows: Array<{ isrc: string; playlist_key: string; valid_to: string | null }> = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data: page } = await svc
        .from("playlist_memberships")
        .select("isrc,playlist_key,valid_to")
        .in("playlist_key", distroKeys)
        .or(`valid_to.is.null,valid_to.gte.${todayDate}`)
        .range(from, from + pageSize - 1);
      const rows = (page ?? []) as typeof allMembershipRows;
      allMembershipRows.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    for (const r of allMembershipRows) {
      const info = distroInfoByKey.get(r.playlist_key);
      if (!info) continue;
      if (!isrcDistroMap.has(r.isrc)) isrcDistroMap.set(r.isrc, []);
      isrcDistroMap.get(r.isrc)!.push(info);
    }

    // Aggregate distro playlists per artist (deduplicated by playlist key)
    for (const track of trackRows) {
      const distros = isrcDistroMap.get(track.isrc) ?? [];
      for (const artistId of (track.spotify_artist_ids ?? [])) {
        if (!artistDistroMap.has(artistId)) artistDistroMap.set(artistId, []);
        const existing = artistDistroMap.get(artistId)!;
        for (const d of distros) {
          if (!existing.some((e) => e.key === d.key)) existing.push(d);
        }
      }
    }
  }

  const tracksWithData = trackRows.map((track) => ({
    isrc: track.isrc,
    name: track.name,
    release_date: track.release_date ?? null,
    last_seen: track.last_seen ?? null,
    albumImageUrl: track.spotify_album_image_url ?? null,
    artistNames: track.spotify_artist_names ?? null,
    artistIds: track.spotify_artist_ids ?? null,
    externalUrl: track.spotify_track_id ? `https://open.spotify.com/track/${track.spotify_track_id}` : null,
    totalStreams: trackStats.get(track.isrc)?.totalStreams ?? null,
    dailyStreams: trackStats.get(track.isrc)?.dailyStreams ?? null,
    distroPlaylists: isrcDistroMap.get(track.isrc) ?? [],
  }));

  const artistsWithStats = artistsWithData.map((artist) => {
    const stats = artistStats.get(artist.id);
    return {
      ...artist,
      totalStreams: stats?.totalStreams ?? null,
      dailyStreams: stats?.dailyStreams ?? null,
      trackCount: stats?.trackCount ?? 0,
      dailyTrackCount: stats?.dailyTrackCount ?? 0,
      distroPlaylists: artistDistroMap.get(artist.id) ?? [],
    };
  });

  return (
    <div className="space-y-4">
      <ArtistsConfigClient
        artists={artistsWithStats}
        totalCount={artists.length}
        allTracks={tracksWithData}
      />
      
      <TracksConfigClient
        tracks={tracksWithData}
        totalCount={tracksWithData.length}
      />
    </div>
  );
}
