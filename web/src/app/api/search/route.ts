import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getArtists } from "@/lib/spotify";

type SearchResult = {
  type: "track" | "artist" | "playlist";
  id: string;
  name: string;
  subtitle?: string;
  imageUrl?: string;
  trackCount?: number;
  firstArtistId?: string | null;
  artistIds?: string[] | null;
  artistNames?: string[] | null;
};

function normalizeStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string") as string[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed)
        ? (parsed.filter((x) => typeof x === "string") as string[])
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function scoreArtistNameMatch(artistName: string, query: string): number {
  const a = (artistName ?? "").trim().toLowerCase();
  const q = (query ?? "").trim().toLowerCase();
  if (!a || !q) return 0;
  if (a === q) return 100;
  if (a.startsWith(q)) return 80;
  // Prefer word-boundary-ish matches over arbitrary substrings
  if (a.includes(` ${q}`)) return 70;
  if (a.includes(q)) return 60;
  return 0;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q")?.trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const sb = await supabaseServer();
    const artists: SearchResult[] = [];
    const tracks: SearchResult[] = [];
    const playlists: SearchResult[] = [];

    // 1. Search for artists first (prioritized)
    // IMPORTANT: Do NOT scan tracks in app code. Use a SQL function to search
    // across all tracks efficiently and correctly.
    const { data: artistRows, error: artistErr } = await sb.rpc("search_artists", {
      q: query,
      max_results: 20,
    });
    if (artistErr) {
      // If the DB function isn't deployed yet, fail soft (tracks/playlists can still work).
      console.warn("search_artists RPC failed:", artistErr);
    }

    // Determine the "primary" artist match for this query so we can order tracks.
    // Example: query "dosa" should prioritize artist "DOSA" tracks above "8DOSA".
    const primaryArtistId: string | null = (() => {
      let bestId: string | null = null;
      let bestScore = -1;
      for (const r of artistRows ?? []) {
        const id = String((r as any).spotify_artist_id ?? "");
        const name = String((r as any).spotify_artist_name ?? "");
        if (!id || !name) continue;
        const s = scoreArtistNameMatch(name, query);
        if (s > bestScore) {
          bestScore = s;
          bestId = id;
        }
      }
      return bestId;
    })();

    const artistIds = (artistRows ?? [])
      .map((r: any) => String(r.spotify_artist_id ?? ""))
      .filter(Boolean);

    // Fetch artist images from Spotify
    let artistImages = new Map<string, string | null>();
    if (artistIds.length > 0) {
      const artistDataMap = await getArtists(artistIds);
      for (const [id, data] of artistDataMap) {
        artistImages.set(id, data?.imageUrl || null);
      }
    }

    for (const r of artistRows ?? []) {
      const id = String((r as any).spotify_artist_id ?? "");
      const name = String((r as any).spotify_artist_name ?? "");
      const trackCount = Number((r as any).track_count ?? 0);
      if (!id || !name) continue;
      artists.push({
        type: "artist",
        id,
        name,
        imageUrl: artistImages.get(id) || undefined,
        trackCount,
      });
    }

    // 2. Search for tracks by name and ISRC
    const { data: tracksData } = await sb
      .from("tracks")
      .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
      .or(`isrc.ilike.%${query}%,name.ilike.%${query}%`)
      .limit(50);
    
    // If query has multiple words, also try splitting and searching for individual words
    // e.g. "Revelries Somewhere" → also search for "Revelries" (artist) and "Somewhere" (track)
    let additionalTracksData: any[] = [];
    const queryParts = query.split(/\s+/).filter(Boolean);
    if (queryParts.length > 1) {
      // Try searching for tracks matching ANY of the query parts
      const { data: extraTracks } = await sb
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
        .or(queryParts.map(part => `name.ilike.%${part}%`).join(","))
        .limit(50);
      additionalTracksData = extraTracks ?? [];
    }

    // Deduplicate by isrc and convert to search results
    const seenIsrcs = new Set<string>();
    const allTracksData = [...(tracksData ?? []), ...additionalTracksData];
    
    if (allTracksData.length > 0) {
      tracks.push(
        ...allTracksData
          .filter((track: any) => {
            if (seenIsrcs.has(track.isrc)) return false;
            seenIsrcs.add(track.isrc);
            return true;
          })
          .map((track: any): SearchResult => {
            const artistNames = normalizeStringArray(track.spotify_artist_names);
            const artistIds = normalizeStringArray(track.spotify_artist_ids);
            
            return {
              type: "track" as const,
              id: track.isrc,
              name: track.name || track.isrc,
              subtitle: artistNames?.join(", ") || "Unknown Artist",
              imageUrl: track.spotify_album_image_url || undefined,
              firstArtistId: artistIds?.[0] || null,
              artistIds: artistIds || null,
              artistNames: artistNames || null,
            };
          })
      );
    }

    // 3. If artist matched, also include all tracks for that artist
    if (artistIds.length > 0) {
      const { data: artistTracks } = await sb
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
        // IMPORTANT: "contains" with an array means the track must contain *all* artistIds.
        // When multiple artists match (e.g. searching "dosa" returns both DOSA and 8DOSA),
        // that can yield zero tracks. We want ANY overlap.
        .overlaps("spotify_artist_ids", artistIds)
        .order("last_seen", { ascending: false })
        .limit(200);

      if (artistTracks) {
        for (const track of artistTracks) {
          const artistNames = normalizeStringArray(track.spotify_artist_names);
          const artistIdList = normalizeStringArray(track.spotify_artist_ids);
          
          // Avoid duplicates
          if (!tracks.find(r => r.type === "track" && r.id === track.isrc)) {
            tracks.push({
              type: "track",
              id: track.isrc,
              name: track.name,
              subtitle: artistNames?.join(", ") || "Unknown Artist",
              imageUrl: track.spotify_album_image_url || undefined,
              firstArtistId: artistIdList?.[0] || null,
              artistIds: artistIdList || null,
              artistNames: artistNames || null,
            });
          }
        }
      }
    }

    // 4. Search for playlists
    const { data: playlistsData } = await sb
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url")
      .or(
        `playlist_key.ilike.%${query}%,display_name.ilike.%${query}%`
      )
      .limit(20);

    if (playlistsData) {
      // Get track counts for playlists
      for (const playlist of playlistsData) {
        const { count } = await sb
          .from("playlist_memberships")
          .select("*", { count: "exact", head: true })
          .eq("playlist_key", playlist.playlist_key)
          .is("valid_to", null);
        
        playlists.push({
          type: "playlist",
          id: playlist.playlist_key,
          name: playlist.display_name || playlist.playlist_key,
          imageUrl: playlist.spotify_playlist_image_url || undefined,
          trackCount: count || 0,
        });
      }
    }

    // Prefer tracks from the best matching artist first (stable).
    if (primaryArtistId) {
      const preferred: SearchResult[] = [];
      const others: SearchResult[] = [];
      for (const t of tracks) {
        const ids = t.artistIds ?? [];
        if (ids.includes(primaryArtistId)) preferred.push(t);
        else others.push(t);
      }
      tracks.splice(0, tracks.length, ...preferred, ...others);
    }

    // Combine results with artists first, then tracks, then playlists
    const results = [...artists, ...tracks, ...playlists];

    return NextResponse.json({
      results: results,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
