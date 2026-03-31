import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_RATIO = 1.25;
const RATIO_MIN = 1.1;
const RATIO_MAX = 5;

function clampRatio(n: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, Math.round(n * 100) / 100));
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("artificial_streams_spike_ratio")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({
        artificial_streams_spike_ratio: DEFAULT_RATIO,
        configured: false as const,
      });
    }
    return apiJsonErr(error.message, 500);
  }

  const row = (settings ?? {}) as Record<string, unknown>;
  const raw = row.artificial_streams_spike_ratio;
  const ratio =
    raw != null && Number.isFinite(Number(raw)) ? clampRatio(Number(raw)) : DEFAULT_RATIO;

  return apiJsonOk({
    artificial_streams_spike_ratio: ratio,
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  const n = Number(body.artificial_streams_spike_ratio ?? body.spike_ratio ?? body.value);
  if (!Number.isFinite(n)) {
    return apiJsonErr("spike ratio must be a number.", 400);
  }
  const ratio = clampRatio(n);

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, artificial_streams_spike_ratio: ratio }], {
      onConflict: "user_id",
    })
    .select("artificial_streams_spike_ratio")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "User settings column is not available yet. Apply migrations, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  const row = (upserted ?? {}) as Record<string, unknown>;
  const saved = row.artificial_streams_spike_ratio;
  const out =
    saved != null && Number.isFinite(Number(saved)) ? clampRatio(Number(saved)) : ratio;

  return apiJsonOk({
    artificial_streams_spike_ratio: out,
    configured: true as const,
  });
}
