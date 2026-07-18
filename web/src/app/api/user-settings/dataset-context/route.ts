import { NextRequest } from "next/server";

import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireUser } from "@/lib/api/server";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import type { TableInsert } from "@/lib/supabase/appDatabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Combined "switch dataset universe" endpoint. Sets `dataset_mode` and (when relevant)
 * `competitor_label_key` in a single upsert so the UI only pays one round-trip when the
 * user picks a different competitor or flips back to own catalog.
 *
 * Body shape: { dataset_mode: "own" | "competitor", competitor_label_key?: string }
 */
export async function PATCH(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const rawMode = body.dataset_mode;
  if (rawMode !== "own" && rawMode !== "competitor") {
    return apiJsonErr("invalid_dataset_mode", 400);
  }
  const datasetMode = normalizeDatasetMode(rawMode);

  const update: TableInsert<"user_settings"> = {
    user_id: auth.user.id,
    dataset_mode: datasetMode,
  };

  if (datasetMode === "competitor") {
    const rawKey = typeof body.competitor_label_key === "string" ? body.competitor_label_key.trim() : "";
    const competitorLabelKey = rawKey || ALL_COMPETITORS_KEY;

    if (competitorLabelKey !== ALL_COMPETITORS_KEY) {
      // Validate the label exists & is active. This protects against typos/stale UI.
      const svc = supabaseService();
      const { data: label } = await svc
        .schema("competitor")
        .from("labels")
        .select("label_key")
        .eq("label_key", competitorLabelKey)
        .eq("is_active", true)
        .maybeSingle();
      if (!label) return apiJsonErr("Unknown competitor label", 400);
    }

    update.competitor_label_key = competitorLabelKey;
  }

  // Use the service client for the upsert so we don't depend on per-user RLS policies for
  // the user_settings row (matches the behavior of the existing per-field endpoints).
  const svc = supabaseService();
  const { error } = await svc.from("user_settings").upsert(update, { onConflict: "user_id" });
  if (error) return apiJsonErr(error.message, 500);

  return apiJsonOk({
    dataset_mode: datasetMode,
    competitor_label_key: datasetMode === "competitor" ? (update.competitor_label_key as string) : null,
  });
}
