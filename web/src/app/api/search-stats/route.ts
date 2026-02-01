import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";

// This route is querystring-driven and therefore dynamic; cache via cachedQuery keyed by latest run.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type"); // "track", "artist", or "playlist"
    const id = searchParams.get("id");

    if (!type || !id) {
      return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
    }

    const sb = await supabaseServer();

    // Use the canonical latest run date from playlist_daily_stats (fast, indexed).
    const { data: latestRun } = await cachedQuery(
      async () =>
        await sb
          .from("playlist_daily_stats")
          .select("date")
          .eq("playlist_key", "all_catalog")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      "search-stats-latest-run-date",
      300,
    );
    const latestRunDate = (latestRun as { date?: string } | null)?.date ?? null;

    const cacheKey = `search-stats-v2-${type}-${id}-${latestRunDate ?? "none"}`;
    const { data: payload } = await cachedQuery(
      async () => {
        if (type === "track") {
          // Track: use latest snapshot date when available; fallback to "latest row".
          const q = sb.from("track_daily_streams_effective_public").select("streams_cumulative");
          const { data: trackStats } = latestRunDate
            ? await q.eq("date", latestRunDate).eq("isrc", id).maybeSingle()
            : await q.eq("isrc", id).order("date", { ascending: false }).limit(1).maybeSingle();

          return { data: { type: "track", streams: Number((trackStats as any)?.streams_cumulative ?? 0) }, error: null };
        }

        if (!latestRunDate) {
          return { data: { type, streams: 0 }, error: null };
        }

        if (type === "artist") {
          const { data: totalStreams, error } = await sb.rpc("artist_total_streams_for_date", {
            artist_id: id,
            run_date: latestRunDate,
          });
          if (error) return { data: { type: "artist", streams: 0 }, error };
          return { data: { type: "artist", streams: Number(totalStreams ?? 0) }, error: null };
        }

        if (type === "playlist") {
          const { data: totalStreams, error } = await sb.rpc("playlist_total_streams_for_date", {
            playlist_key: id,
            run_date: latestRunDate,
          });
          if (error) return { data: { type: "playlist", streams: 0 }, error };
          return { data: { type: "playlist", streams: Number(totalStreams ?? 0) }, error: null };
        }

        return { data: null, error: new Error("Invalid type") };
      },
      cacheKey,
      86400,
    );

    if (payload) return NextResponse.json(payload);

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("Search stats error:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
