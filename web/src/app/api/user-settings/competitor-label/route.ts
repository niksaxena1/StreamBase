import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const competitorLabelKey = typeof body.competitor_label_key === "string"
    ? body.competitor_label_key.trim()
    : "";
  if (!competitorLabelKey) return apiJsonErr("competitor_label_key is required", 400);

  const svc = supabaseService();
  if (competitorLabelKey === ALL_COMPETITORS_KEY) {
    const { error } = await svc
      .from("user_settings")
      .upsert({ user_id: auth.user.id, competitor_label_key: ALL_COMPETITORS_KEY }, { onConflict: "user_id" });
    if (error) return apiJsonErr(error.message, 500);
    return apiJsonOk({ competitor_label_key: ALL_COMPETITORS_KEY });
  }

  const { data: label } = await svc
    .schema("competitor")
    .from("labels")
    .select("label_key")
    .eq("label_key", competitorLabelKey)
    .eq("is_active", true)
    .maybeSingle();
  if (!label) return apiJsonErr("Unknown competitor label", 400);

  const { error } = await svc
    .from("user_settings")
    .upsert({ user_id: auth.user.id, competitor_label_key: competitorLabelKey }, { onConflict: "user_id" });
  if (error) return apiJsonErr(error.message, 500);

  return apiJsonOk({ competitor_label_key: competitorLabelKey });
}
