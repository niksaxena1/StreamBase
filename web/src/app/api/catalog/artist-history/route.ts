import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { CACHE_TTL_1H } from "@/lib/constants";
import { fetchCatalogArtistSeries } from "@/app/(main-flat)/catalog/catalogPageQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Older (cold / archived) part of a Catalog artist series. The page renders the recent year first and the client
 * fills older history from here, because the cold artist aggregate can take many seconds for large artists.
 * Run-date basis, same row shape as the page's own artist series; cached for an hour per artist and range.
 */
export async function GET(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const artistId = (params.get("artist_id") ?? "").trim();
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  if (!artistId || artistId.length > 64 || !ISO_DATE.test(start) || !ISO_DATE.test(end) || start > end) {
    return apiJsonErr("artist_id, start and end (YYYY-MM-DD) are required", 400);
  }

  const svc = supabaseService();
  let overrideBuster = "0";
  try {
    const { data: version } = await svc.rpc("spotibase_override_version");
    if (typeof version === "string" && version) overrideBuster = version;
  } catch {
    // ignore (function may not exist yet)
  }

  const { data, error } = await cachedQuery(
    async () => await fetchCatalogArtistSeries(svc, { artistId, startDate: start, endDate: end }),
    `catalog-artist-series-older-v1-${artistId}-${start}-${end}-ov${overrideBuster}`,
    CACHE_TTL_1H,
  );
  if (error) return apiJsonErr(error.message, 500);

  const rows = ((data ?? []) as Array<{ date: string; streams_cumulative: number | null }>).map((r) => ({
    date: r.date,
    streams_cumulative: r.streams_cumulative,
  }));
  return apiJsonOk({ rows }, { headers: { "Cache-Control": "private, max-age=300" } });
}
