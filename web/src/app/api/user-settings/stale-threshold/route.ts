import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { DEFAULT_STALE_MIN_STREAMS } from "@/lib/constants";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_MIN_STREAMS = DEFAULT_STALE_MIN_STREAMS;
const DEFAULT_MIN_AVG_DAILY = 10;

function parseNonNegativeInt(raw: unknown, label: string): number {
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${label} must be a whole number.`);
  if (n < 0) throw new Error(`${label} must be non-negative.`);
  return n;
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("stale_track_min_streams,stale_track_min_avg_daily")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({
        stale_track_min_streams: DEFAULT_MIN_STREAMS,
        stale_track_min_avg_daily: DEFAULT_MIN_AVG_DAILY,
        configured: false as const,
      });
    }
    return apiJsonErr(error.message, 500);
  }

  const row = (settings ?? {}) as Record<string, unknown>;
  const minStreams = Number(row.stale_track_min_streams ?? DEFAULT_MIN_STREAMS);
  const minAvgDaily = Number(row.stale_track_min_avg_daily ?? DEFAULT_MIN_AVG_DAILY);

  return apiJsonOk({
    stale_track_min_streams: Number.isFinite(minStreams) ? minStreams : DEFAULT_MIN_STREAMS,
    stale_track_min_avg_daily: Number.isFinite(minAvgDaily) ? minAvgDaily : DEFAULT_MIN_AVG_DAILY,
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);

  let minStreams: number;
  let minAvgDaily: number;
  try {
    minStreams = parseNonNegativeInt(body.stale_track_min_streams ?? body.threshold ?? body.value, "Min total streams");
    minAvgDaily = parseNonNegativeInt(body.stale_track_min_avg_daily ?? DEFAULT_MIN_AVG_DAILY, "Min avg daily streams");
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid value.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert(
      [
        {
          user_id: auth.user.id,
          stale_track_min_streams: minStreams,
          stale_track_min_avg_daily: minAvgDaily,
        },
      ],
      { onConflict: "user_id" },
    )
    .select("stale_track_min_streams,stale_track_min_avg_daily")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr("Stale threshold settings aren't configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  const row = (upserted ?? {}) as Record<string, unknown>;
  const savedMinStreams = Number(row.stale_track_min_streams ?? minStreams);
  const savedMinAvgDaily = Number(row.stale_track_min_avg_daily ?? minAvgDaily);

  return apiJsonOk({
    stale_track_min_streams: Number.isFinite(savedMinStreams) ? savedMinStreams : minStreams,
    stale_track_min_avg_daily: Number.isFinite(savedMinAvgDaily) ? savedMinAvgDaily : minAvgDaily,
    configured: true as const,
  });
}
