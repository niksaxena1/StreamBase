import { NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "artificial_streams_warning_enabled";

function toEnabled(raw: unknown): boolean {
  return Number(raw ?? 1) !== 0;
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data, error } = await svc
    .from("health_config")
    .select("value_numeric")
    .eq("key", KEY)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ artificial_streams_warning_enabled: true, configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  revalidateTag("health", "max");
  revalidatePath("/health");
  revalidatePath("/settings");

  return apiJsonOk({
    artificial_streams_warning_enabled: toEnabled((data as { value_numeric?: unknown } | null)?.value_numeric),
    configured: true as const,
  });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(request);
  const enabled = Boolean(body.artificial_streams_warning_enabled ?? body.enabled);

  const svc = supabaseService();
  const { data, error } = await svc
    .from("health_config")
    .upsert(
      [
        {
          key: KEY,
          value_numeric: enabled ? 1 : 0,
          description:
            "When 1, ingestion emits artificial_stream_spike Health warnings. Set to 0 to disable the warning while the detector is being redesigned.",
        },
      ],
      { onConflict: "key" },
    )
    .select("value_numeric")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr("Health config is not available yet. Apply migrations, then retry.", 503);
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({
    artificial_streams_warning_enabled: toEnabled((data as { value_numeric?: unknown } | null)?.value_numeric),
    configured: true as const,
  });
}
