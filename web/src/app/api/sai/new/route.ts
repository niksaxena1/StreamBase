import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const svc = supabaseService();
  const nowIso = new Date().toISOString();

  const { data: oldConvos } = await svc
    .from("sai_conversations")
    .select("id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(50);

  const oldIds = (oldConvos ?? [])
    .map((r: { id?: string }) => r.id)
    .filter((x): x is string => Boolean(x));
  if (oldIds.length > 0) {
    await svc.from("sai_conversations").update({ deleted_at: nowIso }).in("id", oldIds);
    await svc.from("sai_messages").delete().in("conversation_id", oldIds);
  }

  const { data: inserted, error } = await svc
    .from("sai_conversations")
    .insert([{ user_id: user.id }])
    .select("id")
    .maybeSingle();

  if (error || !inserted?.id) {
    return apiJsonErr(error?.message ?? "failed to create conversation", 500);
  }

  return apiJsonOk({ conversationId: inserted.id });
}
