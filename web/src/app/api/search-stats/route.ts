import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { CACHE_TTL_5MIN, CACHE_TTL_24H } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { apiJsonErr, apiJsonOk, requireSessionUser } from "@/lib/api/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sb = await supabaseServer();
    const auth = await requireSessionUser(sb);
    if (!auth.ok) return auth.response;

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get("type");
    const id = searchParams.get("id");

    if (!type || !id) {
      return apiJsonErr("Missing type or id", 400);
    }

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
      CACHE_TTL_5MIN,
    );
    const latestRunDate = (latestRun as { date?: string } | null)?.date ?? null;

    const cacheKey = `search-stats-v2-${type}-${id}-${latestRunDate ?? "none"}`;
    const { data: payload } = await cachedQuery(
      async () => {
        if (type === "track") {
          const q = sb.from("track_daily_streams_effective_public").select("streams_cumulative");
          const { data: trackStats } = latestRunDate
            ? await q.eq("date", latestRunDate).eq("isrc", id).maybeSingle()
            : await q.eq("isrc", id).order("date", { ascending: false }).limit(1).maybeSingle();

          return {
            data: { type: "track" as const, streams: Number((trackStats as { streams_cumulative?: number } | null)?.streams_cumulative ?? 0) },
            error: null,
          };
        }

        if (!latestRunDate) {
          return { data: { type, streams: 0 }, error: null };
        }

        if (type === "artist") {
          const { data: totalStreams, error } = await sb.rpc("artist_total_streams_for_date", {
            artist_id: id,
            run_date: latestRunDate,
          });
          if (error) return { data: { type: "artist" as const, streams: 0 }, error };
          return { data: { type: "artist" as const, streams: Number(totalStreams ?? 0) }, error: null };
        }

        if (type === "playlist") {
          const { data: totalStreams, error } = await sb.rpc("playlist_total_streams_for_date", {
            playlist_key: id,
            run_date: latestRunDate,
          });
          if (error) return { data: { type: "playlist" as const, streams: 0 }, error };
          return { data: { type: "playlist" as const, streams: Number(totalStreams ?? 0) }, error: null };
        }

        return { data: null, error: new Error("Invalid type") };
      },
      cacheKey,
      CACHE_TTL_24H,
    );

    if (payload) return apiJsonOk(payload);

    return apiJsonErr("Invalid type", 400);
  } catch (error) {
    logError("Search stats error", error);
    return apiJsonErr("Failed to fetch stats", 500);
  }
}
