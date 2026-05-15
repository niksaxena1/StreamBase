import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ENABLED = true;

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("rapidapi_auto_fix_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({
        rapidapi_auto_fix_enabled: DEFAULT_ENABLED,
        configured: false as const,
      });
    }
    return apiJsonErr(error.message, 500);
  }

  const row = settings as Record<string, unknown> | null;
  const enabled = row?.rapidapi_auto_fix_enabled;
  return apiJsonOk({
    rapidapi_auto_fix_enabled: typeof enabled === "boolean" ? enabled : DEFAULT_ENABLED,
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);

  const patch: Record<string, unknown> = { user_id: auth.user.id };

  if (body.rapidapi_auto_fix_enabled !== undefined) {
    const raw = body.rapidapi_auto_fix_enabled;
    if (typeof raw === "boolean") {
      patch.rapidapi_auto_fix_enabled = raw;
    } else {
      const s = String(raw ?? "").trim().toLowerCase();
      if (s === "true" || s === "1") patch.rapidapi_auto_fix_enabled = true;
      else if (s === "false" || s === "0") patch.rapidapi_auto_fix_enabled = false;
      else return apiJsonErr("rapidapi_auto_fix_enabled must be a boolean.", 400);
    }
  }

  if (Object.keys(patch).length === 1) {
    return apiJsonErr("No recognised field provided.", 400);
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([patch], { onConflict: "user_id" })
    .select("rapidapi_auto_fix_enabled")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr("Setting isn't configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  const row = upserted as Record<string, unknown> | null;
  const savedEnabled = row?.rapidapi_auto_fix_enabled;
  return apiJsonOk({
    rapidapi_auto_fix_enabled:
      typeof savedEnabled === "boolean" ? savedEnabled : (patch.rapidapi_auto_fix_enabled ?? DEFAULT_ENABLED),
    configured: true as const,
  });
}
