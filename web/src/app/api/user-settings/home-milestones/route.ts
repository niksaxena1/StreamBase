import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeCsv(raw: unknown): string | null {
  if (raw === null) return null;
  if (raw === undefined) return null;
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const parts = s
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new Error("Milestones must be comma-separated whole numbers.");
    const n = Number(p);
    if (!Number.isFinite(n) || n < 100_000) throw new Error("Minimum milestone is 100000 streams.");
    nums.push(Math.round(n));
  }

  const uniqDesc = Array.from(new Set(nums)).sort((a, b) => b - a);
  return uniqDesc.length ? uniqDesc.join(",") : null;
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("home_custom_milestones_streams")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ home_custom_milestones_streams: null, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({
    home_custom_milestones_streams:
      (settings as { home_custom_milestones_streams?: string | null } | null)?.home_custom_milestones_streams ?? null,
    configured: true as const,
  });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  let csv: string | null;
  try {
    csv = normalizeCsv(body.home_custom_milestones_streams ?? body.milestones_csv);
  } catch (e) {
    return apiJsonErr(e instanceof Error ? e.message : "Invalid milestones.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, home_custom_milestones_streams: csv }], { onConflict: "user_id" })
    .select("home_custom_milestones_streams")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Home milestones setting isn’t configured in the database yet. Add the `home_custom_milestones_streams` column to `user_settings`, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({
    home_custom_milestones_streams:
      (upserted as { home_custom_milestones_streams?: string | null } | null)?.home_custom_milestones_streams ?? csv,
    configured: true as const,
  });
}
