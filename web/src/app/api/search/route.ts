import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getArtists } from "@/lib/spotify";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q")?.trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const sb = await supabaseServer();
    const lowerQuery = query.toLowerCase();
    const artists: any[] = [];
    const tracks: any[] = [];
    const playlists: any[] = [];

    // 1. Search for artists first (prioritized)
    const { data: allTracks } = await sb
      .from("tracks")
      .select("spotify_artist_ids,spotify_artist_names")
      .not("spotify_artist_ids", "is", null)
      .limit(100);

    const artistMap = new Map<string, string>();
    if (allTracks) {
      for (const track of allTracks) {
        const ids = track.spotify_artist_ids || [];
        const names = track.spotify_artist_names || [];
        for (let i = 0; i < Math.min(ids.length, names.length); i++) {
          if (ids[i] && names[i] && names[i].toLowerCase().includes(lowerQuery)) {
            if (!artistMap.has(ids[i])) {
              artistMap.set(ids[i], names[i]);
            }
          }
        }
      }
    }

    // Fetch artist images from Spotify
    const artistIds = Array.from(artistMap.keys());
    let artistImages = new Map<string, string | null>();
    if (artistIds.length > 0) {
      const artistDataMap = await getArtists(artistIds);
      for (const [id, data] of artistDataMap) {
        artistImages.set(id, data?.imageUrl || null);
      }
    }

    // Get track counts for artists efficiently
    const artistTrackCounts = new Map<string, number>();
    if (artistIds.length > 0) {
      const { data: trackCountData } = await sb
        .from("tracks")
        .select("spotify_artist_ids")
        .contains("spotify_artist_ids", artistIds);
      
      // Count tracks per artist from the result set
      if (trackCountData) {
        for (const track of trackCountData) {
          const ids = track.spotify_artist_ids || [];
          for (const id of ids) {
            if (artistTrackCounts.has(id)) {
              artistTrackCounts.set(id, (artistTrackCounts.get(id) || 0) + 1);
            } else if (artistIds.includes(id)) {
              artistTrackCounts.set(id, 1);
            }
          }
        }
      }
    }

    for (const [artistId, artistName] of artistMap) {
      artists.push({
        type: "artist",
        id: artistId,
        name: artistName,
        imageUrl: artistImages.get(artistId) || undefined,
        trackCount: artistTrackCounts.get(artistId) || 0,
      });
    }

    // 2. Search for tracks
    const { data: tracksData } = await sb
      .from("tracks")
      .select("isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url")
      .or(`isrc.ilike.%${query}%,name.ilike.%${query}%`)
      .limit(50);

    if (tracksData) {
      tracks.push(
        ...tracksData.map((track: any) => ({
          type: "track",
          id: track.isrc,
          name: track.name || track.isrc,
          subtitle: track.spotify_artist_names?.join(", ") || "Unknown Artist",
          imageUrl: track.spotify_album_image_url || undefined,
          firstArtistId: track.spotify_artist_ids?.[0] || null,
          artistIds: track.spotify_artist_ids || null,
          artistNames: track.spotify_artist_names || null,
        }))
      );
    }

    // 3. If artist matched, also include all tracks for that artist
    if (artistIds.length > 0) {
      const { data: artistTracks } = await sb
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
        .contains("spotify_artist_ids", artistIds)
        .order("last_seen", { ascending: false })
        .limit(200);

      if (artistTracks) {
        for (const track of artistTracks) {
          // Avoid duplicates
          if (!tracks.find(r => r.type === "track" && r.id === track.isrc)) {
            tracks.push({
              type: "track",
              id: track.isrc,
              name: track.name,
              subtitle: track.spotify_artist_names?.join(", ") || "Unknown Artist",
              imageUrl: track.spotify_album_image_url || undefined,
              firstArtistId: track.spotify_artist_ids?.[0] || null,
              artistIds: track.spotify_artist_ids || null,
              artistNames: track.spotify_artist_names || null,
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
