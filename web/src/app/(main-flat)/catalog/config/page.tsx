import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getArtists } from "@/lib/spotify";
import { ArtistsList } from "./ArtistsList";
import { ArtistsConfigClient } from "./ArtistsConfigClient";
import { TracksConfigClient } from "./TracksConfigClient";

export const revalidate = 86400; // 24h ISR - catalog config uses daily snapshots

type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_artist_ids: string[] | null;
  spotify_artist_names: string[] | null;
};

type TrackDailyRow = {
  date: string;
  isrc: string;
  streams_cumulative: number | null;
};

function deriveArtists(rows: TrackRow[]) {
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

async function fetchAllTracksMeta(
  sb: Awaited<ReturnType<typeof supabaseServer>>,
  maxRows = 5000,
): Promise<TrackRow[]> {
  const pageSize = 1000;
  const out: TrackRow[] = [];
  let from = 0;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from("tracks")
      .select("isrc,name,spotify_artist_ids,spotify_artist_names")
      .not("spotify_artist_ids", "is", null)
      .order("last_seen", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("Error fetching tracks:", error);
      break;
    }

    const rows = (data ?? []) as TrackRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
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

  const trackMetaRows = await fetchAllTracksMeta(sb, 5000);
  const artists = deriveArtists(trackMetaRows);

  // Fetch artist data from Spotify API
  const artistIds = artists.map((a) => a.id);
  const artistDataMap = await getArtists(artistIds);

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

  // Fetch all tracks for the tracks table
  const trackRows = await fetchAllTracksForTable(sb, 5000);
  
  // Fetch track daily streams for stats
  const trackDailyStreams = await fetchTrackDailyStreams(svc, 2);
  
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
  };
  
  const artistStats = new Map<string, ArtistStats>();
  for (const artist of artists) {
    let artistTotalStreams = 0;
    let artistDailyStreams = 0;
    let hasTotalStats = false;
    let hasDailyStats = false;
    
    // Find all tracks for this artist and sum their stats
    for (const track of trackRows) {
      if (track.spotify_artist_ids?.includes(artist.id)) {
        const stats = trackStats.get(track.isrc);
        if (stats?.totalStreams !== null) {
          artistTotalStreams += stats.totalStreams;
          hasTotalStats = true;
        }
        if (stats?.dailyStreams !== null) {
          artistDailyStreams += stats.dailyStreams;
          hasDailyStats = true;
        }
      }
    }
    
    artistStats.set(artist.id, {
      totalStreams: hasTotalStats ? artistTotalStreams : null,
      dailyStreams: hasDailyStats ? artistDailyStreams : null,
    });
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
  }));

  const artistsWithStats = artistsWithData.map((artist) => ({
    ...artist,
    totalStreams: artistStats.get(artist.id)?.totalStreams ?? null,
    dailyStreams: artistStats.get(artist.id)?.dailyStreams ?? null,
  }));

  return (
    <div className="space-y-4">
      <ArtistsConfigClient 
        artists={artistsWithStats} 
        totalCount={artists.length}
      />
      
      <TracksConfigClient
        tracks={tracksWithData}
        totalCount={tracksWithData.length}
      />
    </div>
  );
}
