import { NextRequest } from "next/server";

import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const { data, error } = await sb
    .from("user_settings")
    .select("dataset_mode")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) return apiJsonErr(error.message, 500);
  return apiJsonOk({ dataset_mode: normalizeDatasetMode(data?.dataset_mode) });
}

export async function PATCH(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const raw = body.dataset_mode;
  if (raw !== "own" && raw !== "competitor") {
    return apiJsonErr("invalid_dataset_mode", 400);
  }

  const datasetMode = normalizeDatasetMode(raw);
  const { error } = await sb
    .from("user_settings")
    .upsert({ user_id: auth.user.id, dataset_mode: datasetMode }, { onConflict: "user_id" });

  if (error) return apiJsonErr(error.message, 500);
  return apiJsonOk({ dataset_mode: datasetMode });
}
