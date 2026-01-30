import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Purge previous conversations for this user (server-side).
  // We use service role so this works even if RLS changes.
  const svc = supabaseService();
  const nowIso = new Date().toISOString();

  // Soft-delete conversations (keeps auditability), then hard-delete messages to "purge" content.
  const { data: oldConvos } = await svc
    .from("sai_conversations")
    .select("id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .limit(50);

  const oldIds = (oldConvos ?? []).map((r: any) => r.id).filter(Boolean);
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
    return NextResponse.json({ error: error?.message ?? "failed to create conversation" }, { status: 500 });
  }

  return NextResponse.json({ conversationId: inserted.id }, { status: 200 });
}

