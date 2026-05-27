import { NextRequest } from "next/server";

import { loadCollectorTracks } from "@/lib/collectors/loadCollectorTracks";
import { CACHE_TTL_1H } from "@/lib/constants";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { addDaysISO } from "@/lib/sotDates";
import { getRollbackDate } from "@/lib/rollback";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const collector = String(req.nextUrl.searchParams.get("collector") ?? "")
    .trim()
    .toUpperCase();
  const latestRunDate = String(req.nextUrl.searchParams.get("run_date") ?? "").trim();

  if (!collector) return apiJsonErr("missing collector", 400);
  if (!isIsoDate(latestRunDate)) return apiJsonErr("invalid run_date", 400);

  const svc = supabaseService();
  const { data: collectorSettings } = await svc
    .from("user_settings")
    .select("collector_entity_playlist_stats_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const useEntityPlaylistsForTotals =
    (collectorSettings as { collector_entity_playlist_stats_enabled?: unknown } | null)
      ?.collector_entity_playlist_stats_enabled === true;

  const prevRunDate = addDaysISO(latestRunDate, -1);
  const rollbackDate = await getRollbackDate();

  let overrideBuster = "0";
  try {
    const { count, data: latestOverride } = await svc
      .from("track_daily_stream_overrides")
      .select("id", { count: "exact" })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const maxId = Number((latestOverride as { id: number } | null)?.id ?? 0);
    overrideBuster = `${Number(count ?? 0)}-${maxId}`;
  } catch {
    // ignore
  }

  const cacheKey = `collectors-tracks-api-${collector}-${latestRunDate}-entity${useEntityPlaylistsForTotals ? 1 : 0}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`;

  const { data: tracks, error } = await cachedQuery(
    async () => {
      try {
        const rows = await loadCollectorTracks({
          selectedCollector: collector,
          latestRunDate,
          prevRunDate,
          useEntityPlaylistsForTotals,
        });
        return { data: rows, error: null };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { data: null, error: { message } };
      }
    },
    cacheKey,
    CACHE_TTL_1H,
  );

  if (error) return apiJsonErr(error.message, 500);

  return apiJsonOk({ tracks: tracks ?? [] });
}
