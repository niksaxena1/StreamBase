import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { isPlaylistWatchOnlyAccess } from "@/lib/appAccess";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { logError } from "@/lib/logger";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import type { ReleaseWeekTrack } from "@/app/(main-flat)/home/releaseWeeks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { svc, user, isAdmin, appAccess } = await getRequestAppContext();
    if (!user) return apiJsonErr("unauthenticated", 401);
    if (isPlaylistWatchOnlyAccess(appAccess) || (!isAdmin && !appAccess.ownCatalog)) return apiJsonErr("forbidden", 403);
    const date = request.nextUrl.searchParams.get("run_date");
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return apiJsonErr("invalid_run_date", 400);
    const tracks: ReleaseWeekTrack[] = [];
    const size = 1000;
    let runDate = date;
    // The generated database types predate this RPC.
    const client: SupabaseClient = svc;
    for (let offset = 0; ; offset += size) {
      const { data, error } = await client.rpc("home_release_week_tracks", runDate ? { p_run_date: runDate } : {}).order("isrc").range(offset, offset + size - 1);
      if (error) throw error;
      const page = (data ?? []) as ReleaseWeekTrack[];
      tracks.push(...page);
      runDate ??= page[0]?.run_date ?? null;
      if (page.length < size) break;
    }
    return apiJsonOk({ runDate: tracks[0]?.run_date ?? null, tracks });
  } catch (error) {
    logError("[home-release-weeks] error", error);
    return apiJsonErr("Failed to load release weeks", 500);
  }
}
