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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get("q")?.trim();

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const sb = await supabaseServer();
    // Spotify-like unified search is done in Postgres (FTS + trigram ranking).
    // This avoids multiple roundtrips and handles multi-token queries naturally.
    const { data: rows, error } = await sb.rpc("search_all", {
      q: query,
      max_results: 40,
    });
    if (error) {
      console.error("search_all RPC failed:", error);
      return NextResponse.json({ results: [] });
    }

    const results: SearchResult[] = (rows ?? []).map((r: any) => ({
      type: r.type,
      id: r.id,
      name: r.name,
      subtitle: r.subtitle ?? undefined,
      imageUrl: r.image_url ?? undefined,
      trackCount: r.track_count ?? undefined,
      firstArtistId: r.first_artist_id ?? null,
      artistIds: r.artist_ids ?? null,
      artistNames: r.artist_names ?? null,
    }));

    // Hydrate artist images from Spotify (top N only)
    const artistIds = results
      .filter((r) => r.type === "artist")
      .map((r) => r.id)
      .slice(0, 20);

    if (artistIds.length > 0) {
      const artistDataMap = await getArtists(artistIds);
      for (const res of results) {
        if (res.type !== "artist") continue;
        const data = artistDataMap.get(res.id);
        if (data?.imageUrl) res.imageUrl = data.imageUrl;
      }
    }

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
