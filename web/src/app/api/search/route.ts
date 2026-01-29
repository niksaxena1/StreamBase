import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q")?.trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const sb = await supabaseServer();

    // Search for both tracks and artists in parallel
    const [tracksResponse, artistsResponse] = await Promise.all([
      // Search tracks
      sb
        .from("tracks")
        .select("isrc,name,spotify_artist_names,spotify_album_image_url")
        .or(
          `isrc.ilike.%${query}%,name.ilike.%${query}%`
        )
        .limit(10),
      // Search artists by deriving from track data
      sb
        .from("tracks")
        .select("spotify_artist_ids,spotify_artist_names")
        .not("spotify_artist_ids", "is", null)
        .limit(100),
    ]);

    const results: any[] = [];

    // Add track results
    if (tracksResponse.data) {
      const tracks = tracksResponse.data.slice(0, 5).map((track: any) => ({
        type: "track",
        id: track.isrc,
        name: track.name || track.isrc,
        subtitle: track.spotify_artist_names
          ? track.spotify_artist_names.join(", ")
          : "Unknown Artist",
        imageUrl: track.spotify_album_image_url || undefined,
      }));
      results.push(...tracks);
    }

    // Add artist results (derived from tracks)
    if (artistsResponse.data) {
      const artistMap = new Map<string, string>();
      for (const track of artistsResponse.data) {
        const ids = track.spotify_artist_ids || [];
        const names = track.spotify_artist_names || [];
        for (let i = 0; i < Math.min(ids.length, names.length); i++) {
          if (
            ids[i] &&
            names[i] &&
            names[i].toLowerCase().includes(query.toLowerCase())
          ) {
            if (!artistMap.has(ids[i])) {
              artistMap.set(ids[i], names[i]);
            }
          }
        }
      }

      const artists = Array.from(artistMap.entries())
        .slice(0, 5)
        .map(([id, name]) => ({
          type: "artist",
          id,
          name,
        }));
      results.push(...artists);
    }

    // Sort by type (tracks first) and limit total results
    return NextResponse.json({
      results: results.slice(0, 10),
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
