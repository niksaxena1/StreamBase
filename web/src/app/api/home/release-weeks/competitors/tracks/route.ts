import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { CACHE_TTL_24H } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { cachedQuery } from "@/lib/supabase/cache";
import type { ReleaseWeekTrack } from "@/app/(main-flat)/home/releaseWeeks";
import { canCompareCompetitorReleaseWeeks } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** One competitor's tracks released in [from, to] (no from/to = tracks without a release date), biggest drop first. */
export async function GET(request: NextRequest) {
  try {
    const { svc, user, isAdmin, appAccess } = await getRequestAppContext();
    if (!user) return apiJsonErr("unauthenticated", 401);
    if (!canCompareCompetitorReleaseWeeks(isAdmin, appAccess)) return apiJsonErr("forbidden", 403);
    const sp = request.nextUrl.searchParams;
    const runDate = sp.get("run_date");
    const label = (sp.get("label") ?? "").trim();
    const from = sp.get("from");
    const to = sp.get("to");
    if (!runDate || !ISO.test(runDate)) return apiJsonErr("invalid_run_date", 400);
    if (!label || !/^[A-Za-z0-9_.-]{1,64}$/.test(label)) return apiJsonErr("invalid_label", 400);
    if ((from && !ISO.test(from)) || (to && !ISO.test(to)) || Boolean(from) !== Boolean(to)) return apiJsonErr("invalid_range", 400);

    // The generated database types predate this RPC.
    const comp = (svc as SupabaseClient).schema("competitor");
    const res = await cachedQuery<Omit<ReleaseWeekTrack, "run_date" | "reset_run_date">[]>(
      async () => {
        const { data, error } = await comp.rpc("release_week_tracks", {
          p_run_date: runDate,
          p_label_key: label,
          p_from: from,
          p_to: to,
          p_limit: 100,
        });
        return { data: (data ?? []) as Omit<ReleaseWeekTrack, "run_date" | "reset_run_date">[], error };
      },
      `home-release-weeks-competitor-tracks|date:${runDate}|label:${label}|from:${from ?? "none"}|to:${to ?? "none"}`,
      CACHE_TTL_24H,
    );
    if (res.error) throw res.error;
    return apiJsonOk({ tracks: res.data ?? [] });
  } catch (error) {
    logError("[home-release-weeks-competitor-tracks] error", error);
    return apiJsonErr("Failed to load competitor tracks", 500);
  }
}
