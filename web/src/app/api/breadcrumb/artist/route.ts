import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artistId = searchParams.get("artist_id");

  if (!artistId) {
    return NextResponse.json({ artistName: null }, { status: 400 });
  }

  try {
    const sb = await supabaseServer();
    
    // Get artist name from first track that has this artist
    const { data: tracks } = await sb
      .from("tracks")
      .select("spotify_artist_names,spotify_artist_ids")
      .contains("spotify_artist_ids", [artistId])
      .limit(1);

    const artistName = tracks?.[0]?.spotify_artist_names?.[0] ?? null;

    return NextResponse.json({ artistName });
  } catch (error) {
    return NextResponse.json({ artistName: null }, { status: 500 });
  }
}
