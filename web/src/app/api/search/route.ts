import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { getArtistsCached } from "@/lib/spotify";
import { logError } from "@/lib/logger";
import { apiJsonErr, apiJsonOk, requireSessionUser } from "@/lib/api/server";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";

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
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(16);
}

export async function GET(request: NextRequest) {
  try {
    const sb = await supabaseServer();
    const auth = await requireSessionUser(sb);
    if (!auth.ok) return auth.response;

    const searchParams = request.nextUrl.searchParams;
    const queryRaw = searchParams.get("q")?.trim();

    if (!queryRaw || queryRaw.length < 2) {
      return apiJsonOk({ results: [] as SearchResult[] });
    }

    const svc = supabaseService();
    const { data: settings } = await svc
      .from("user_settings")
      .select("dataset_mode,competitor_label_key")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
    let competitorLabelKey =
      typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
        ? settings.competitor_label_key.trim()
        : null;
    if (datasetMode === "competitor" && !competitorLabelKey) {
      const { data: labels } = await svc
        .schema("competitor")
        .from("labels")
        .select("label_key,display_name")
        .eq("is_active", true)
        .order("display_name", { ascending: true });
      competitorLabelKey = resolveCompetitorLabelKey(
        null,
        (labels ?? []) as Array<{ label_key: string; display_name: string }>,
      );
    }
    const dataClient = datasetMode === "competitor" ? svc.schema("competitor") : sb;
    const latestClient = datasetMode === "competitor" ? svc.schema("competitor") : svc;

    const { data: latestRun } = await cachedQuery(
      async () =>
        await latestClient
          .from("ingestion_runs")
          .select("run_date")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      `search-latest-ingestion-run-${datasetMode}`,
      600,
    );
    const latestRunDate = (latestRun as { run_date?: string } | null)?.run_date ?? "none";

    const query = queryRaw.toLowerCase();
    const key = `search-${datasetMode}-${competitorLabelKey ?? "none"}-${hashKey(query)}-${latestRunDate}`;

    const { data: payload, error } = await cachedQuery(
      async () => {
        const { data: rows, error: rpcErr } =
          datasetMode === "competitor" && competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY
            ? await dataClient.rpc("search_all_for_label", {
                q: queryRaw,
                label_key: competitorLabelKey,
                max_results: 40,
              })
            : await dataClient.rpc("search_all", {
                q: queryRaw,
                max_results: 40,
              });
        if (rpcErr) return { data: { results: [] as SearchResult[] }, error: rpcErr };

        const results: SearchResult[] = (rows ?? []).map(
          (r: {
            type: SearchResult["type"];
            id: string;
            name: string;
            subtitle?: string | null;
            image_url?: string | null;
            track_count?: number | null;
            first_artist_id?: string | null;
            artist_ids?: string[] | null;
            artist_names?: string[] | null;
          }) => ({
            type: r.type,
            id: r.id,
            name: r.name,
            subtitle: r.subtitle ?? undefined,
            imageUrl: r.image_url ?? undefined,
            trackCount: r.track_count ?? undefined,
            firstArtistId: r.first_artist_id ?? null,
            artistIds: r.artist_ids ?? null,
            artistNames: r.artist_names ?? null,
          }),
        );

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
      86400,
    );

    if (error) {
      logError("[search] cached search failed", error);
      return apiJsonOk({ results: [] as SearchResult[] });
    }

    return apiJsonOk({
      results: (payload as { results?: SearchResult[] } | null)?.results ?? [],
    });
  } catch (error) {
    logError("Search error", error);
    return apiJsonErr("Search failed", 500);
  }
}
