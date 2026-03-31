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
    .select("home_artificial_spikes_section_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ home_artificial_spikes_section_enabled: true, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const raw = (settings as { home_artificial_spikes_section_enabled?: unknown } | null)
    ?.home_artificial_spikes_section_enabled;
  return apiJsonOk({
    home_artificial_spikes_section_enabled:
      raw === undefined || raw === null ? true : Boolean(raw),
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  const enabled = Boolean(body.home_artificial_spikes_section_enabled);

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert(
      [{ user_id: auth.user.id, home_artificial_spikes_section_enabled: enabled }],
      { onConflict: "user_id" },
    )
    .select("home_artificial_spikes_section_enabled")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "This setting isn’t available in the database yet. Apply migrations, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({
    home_artificial_spikes_section_enabled:
      (upserted as { home_artificial_spikes_section_enabled?: unknown } | null)
        ?.home_artificial_spikes_section_enabled ?? enabled,
    configured: true as const,
  });
}
