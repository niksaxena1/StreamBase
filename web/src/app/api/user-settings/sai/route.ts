import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("sai_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Default to true if no settings exist yet
  const saiEnabled = settings?.sai_enabled ?? true;

  return NextResponse.json({ sai_enabled: saiEnabled }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const saiEnabled = Boolean(body.sai_enabled);

  const svc = supabaseService();

  // Try to update first
  const { data: updated, error: updateError } = await svc
    .from("user_settings")
    .update({ sai_enabled: saiEnabled })
    .eq("user_id", user.id)
    .select("sai_enabled")
    .maybeSingle();

  if (updateError && !updateError.message?.includes("no rows")) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // If no rows were updated, insert
  if (!updated) {
    const { data: inserted, error: insertError } = await svc
      .from("user_settings")
      .insert([{ user_id: user.id, sai_enabled: saiEnabled }])
      .select("sai_enabled")
      .maybeSingle();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ sai_enabled: inserted?.sai_enabled ?? saiEnabled }, { status: 200 });
  }

  return NextResponse.json({ sai_enabled: updated.sai_enabled }, { status: 200 });
}
