import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type"); // "track", "artist", or "playlist"
    const id = searchParams.get("id");

    if (!type || !id) {
      return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
    }

    const sb = await supabaseServer();

    if (type === "track") {
      // Get track stats: cumulative streams from most recent entry
      const { data: trackStats } = await sb
        .from("track_daily_streams")
        .select("streams_cumulative")
        .eq("isrc", id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!trackStats) {
        return NextResponse.json({
          type: "track",
          streams: 0,
        });
      }

      return NextResponse.json({
        type: "track",
        streams: trackStats.streams_cumulative || 0,
      });
    } else if (type === "artist") {
      // For artists: fetch all tracks by this artist and sum their cumulative streams
      const { data: artistTracks } = await sb
        .from("tracks")
        .select("isrc")
        .contains("spotify_artist_ids", [id])
        .limit(1000); // Limit to 1000 tracks per artist

      if (!artistTracks || artistTracks.length === 0) {
        return NextResponse.json({
          type: "artist",
          streams: 0,
        });
      }

      const isrcs = artistTracks.map((t: any) => t.isrc);

      // Get most recent cumulative streams for all tracks
      const { data: trackStats } = await sb
        .from("track_daily_streams")
        .select("streams_cumulative")
        .in("isrc", isrcs)
        .order("date", { ascending: false })
        .limit(isrcs.length);

      if (!trackStats || trackStats.length === 0) {
        return NextResponse.json({
          type: "artist",
          streams: 0,
        });
      }

      // Sum cumulative streams (each track appears once with its latest cumulative value)
      const totalStreams = trackStats.reduce(
        (sum: number, track: any) => sum + (track.streams_cumulative || 0),
        0
      );

      return NextResponse.json({
        type: "artist",
        streams: totalStreams,
      });
    } else if (type === "playlist") {
      // Get playlist stats: sum of cumulative streams for all current tracks
      const { data: members } = await sb
        .from("playlist_memberships")
        .select("isrc")
        .eq("playlist_key", id)
        .is("valid_to", null)
        .limit(1000); // Limit to 1000 tracks per playlist

      if (!members || members.length === 0) {
        return NextResponse.json({
          type: "playlist",
          streams: 0,
        });
      }

      const isrcs = members.map((m: any) => m.isrc);

      // Get most recent cumulative streams for all tracks in playlist
      const { data: trackStats } = await sb
        .from("track_daily_streams")
        .select("streams_cumulative")
        .in("isrc", isrcs)
        .order("date", { ascending: false })
        .limit(isrcs.length);

      if (!trackStats || trackStats.length === 0) {
        return NextResponse.json({
          type: "playlist",
          streams: 0,
        });
      }

      // Sum cumulative streams
      const totalStreams = trackStats.reduce(
        (sum: number, track: any) => sum + (track.streams_cumulative || 0),
        0
      );

      return NextResponse.json({
        type: "playlist",
        streams: totalStreams,
      });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("Search stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
