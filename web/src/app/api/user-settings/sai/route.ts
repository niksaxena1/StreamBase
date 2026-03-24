import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("sai_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("Could not find the table") || msg.includes("schema cache")) {
      return apiJsonOk({ sai_enabled: true, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const saiEnabled = settings?.sai_enabled ?? true;

  return apiJsonOk({ sai_enabled: saiEnabled, configured: true as const });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { sai_enabled?: unknown };
  const saiEnabled = Boolean(body.sai_enabled);

  const svc = supabaseService();

  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: auth.user.id, sai_enabled: saiEnabled }], { onConflict: "user_id" })
    .select("sai_enabled")
    .maybeSingle();

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("Could not find the table") || msg.includes("schema cache")) {
      return apiJsonErr("SAI setting isn’t configured in the database yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({ sai_enabled: upserted?.sai_enabled ?? saiEnabled, configured: true as const });
}
