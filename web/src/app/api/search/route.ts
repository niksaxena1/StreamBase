import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { getArtistsCached } from "@/lib/spotify";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

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

function hashKey(input: string): string {
  // Small, stable hash to keep cache keys short.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const queryRaw = searchParams.get("q")?.trim();

    if (!queryRaw || queryRaw.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const sb = await supabaseServer();
    const svc = supabaseService();

    // Cache key invalidation: include latest ingestion run date.
    const { data: latestRun } = await cachedQuery(
      async () =>
        await svc
          .from("ingestion_runs")
          .select("run_date")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      "search-latest-ingestion-run",
      600, // refresh key occasionally; ingestion is daily
    );
    const latestRunDate = (latestRun as any)?.run_date ?? "none";

    const query = queryRaw.toLowerCase();
    const key = `search-${hashKey(query)}-${latestRunDate}`;

    const { data: payload, error } = await cachedQuery(
      async () => {
        // Spotify-like unified search is done in Postgres (FTS + trigram ranking).
        // This avoids multiple roundtrips and handles multi-token queries naturally.
        const { data: rows, error: rpcErr } = await sb.rpc("search_all", {
          q: queryRaw,
          max_results: 40,
        });
        if (rpcErr) return { data: { results: [] as SearchResult[] }, error: rpcErr };

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

        // Hydrate artist images via DB cache (top N only).
        const artistIds = results
          .filter((r) => r.type === "artist")
          .map((r) => r.id)
          .slice(0, 20);

        if (artistIds.length > 0) {
          const artistDataMap = await getArtistsCached(svc, artistIds, { maxAgeDays: 31 });
          for (const res of results) {
            if (res.type !== "artist") continue;
            const data = artistDataMap.get(res.id);
            if (data?.imageUrl) res.imageUrl = data.imageUrl ?? undefined;
          }
        }

        return { data: { results }, error: null };
      },
      key,
      86400, // 24h; invalidates automatically when latestRunDate changes
    );

    if (error) {
      logError("[search] cached search failed", error);
      return NextResponse.json({ results: [] });
    }

    return NextResponse.json({
      results: (payload as any)?.results ?? [],
    });
  } catch (error) {
    logError("Search error", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
