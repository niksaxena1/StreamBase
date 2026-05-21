import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ENABLED = false;

function parseBool(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) throw new Error("Value must be a boolean.");
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  throw new Error("Value must be a boolean.");
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("collector_entity_playlist_stats_enabled")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({
        collector_entity_playlist_stats_enabled: DEFAULT_ENABLED,
        configured: false as const,
      });
    }
    return apiJsonErr(error.message, 500);
  }

  const enabled = (settings as { collector_entity_playlist_stats_enabled?: unknown } | null)
    ?.collector_entity_playlist_stats_enabled;

  return apiJsonOk({
    collector_entity_playlist_stats_enabled: typeof enabled === "boolean" ? enabled : DEFAULT_ENABLED,
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  let enabled: boolean;
  try {
    enabled = parseBool(body.collector_entity_playlist_stats_enabled ?? body.enabled);
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
          collector_entity_playlist_stats_enabled: enabled,
        },
      ],
      { onConflict: "user_id" },
    )
    .select("collector_entity_playlist_stats_enabled")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Collector entity playlist stats are not configured in the database yet. Apply migrations, then retry.",
        503,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  const saved = (upserted as { collector_entity_playlist_stats_enabled?: unknown } | null)
    ?.collector_entity_playlist_stats_enabled;

  revalidatePath("/collectors");
  revalidatePath("/settings");

  return apiJsonOk({
    collector_entity_playlist_stats_enabled: typeof saved === "boolean" ? saved : enabled,
    configured: true as const,
  });
}
