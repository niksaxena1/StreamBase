import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("home_filters_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ home_filters_enabled: true, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const enabled = (settings as { home_filters_enabled?: unknown } | null)?.home_filters_enabled;
  return apiJsonOk({
    home_filters_enabled: enabled === undefined || enabled === null ? true : Boolean(enabled),
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  const enabled = Boolean(body.home_filters_enabled);

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, home_filters_enabled: enabled }], { onConflict: "user_id" })
    .select("home_filters_enabled")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Home Filters setting isn’t configured in the database yet. Add the `home_filters_enabled` column to `user_settings`, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({
    home_filters_enabled: (upserted as { home_filters_enabled?: unknown } | null)?.home_filters_enabled ?? enabled,
    configured: true as const,
  });
}
