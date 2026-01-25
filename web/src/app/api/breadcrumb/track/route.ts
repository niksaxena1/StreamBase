import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isrc = searchParams.get("isrc");

  if (!isrc) {
    return NextResponse.json({ trackLabel: null }, { status: 400 });
  }

  try {
    const sb = await supabaseServer();
    
    const { data: track } = await sb
      .from("tracks")
      .select("name,spotify_artist_names")
      .eq("isrc", isrc)
      .maybeSingle();

    if (!track) {
      return NextResponse.json({ trackLabel: isrc });
    }

    const trackName = track.name ?? isrc;
    const artistNames = track.spotify_artist_names;

    // Format: "[Artist] - [Title]" or just "[Title] ([ISRC])" if no artist
    let trackLabel: string;
    if (artistNames && artistNames.length > 0) {
      trackLabel = `${artistNames[0]} - ${trackName}`;
    } else {
      trackLabel = `${trackName} (${isrc})`;
    }

    return NextResponse.json({ trackLabel });
  } catch (error) {
    return NextResponse.json({ trackLabel: isrc }, { status: 500 });
  }
}
