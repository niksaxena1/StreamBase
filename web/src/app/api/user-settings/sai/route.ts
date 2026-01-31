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
    // Graceful fallback: if the table hasn't been migrated yet, default to enabled.
    // This prevents the UI from breaking on older DBs.
    const msg = String(error.message ?? "");
    if (msg.includes("Could not find the table") || msg.includes("schema cache")) {
      return NextResponse.json({ sai_enabled: true, configured: false }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Default to true if no settings exist yet
  const saiEnabled = settings?.sai_enabled ?? true;

  return NextResponse.json({ sai_enabled: saiEnabled, configured: true }, { status: 200 });
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

  // Use upsert to create/update in one call.
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, sai_enabled: saiEnabled }], { onConflict: "user_id" })
    .select("sai_enabled")
    .maybeSingle();

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("Could not find the table") || msg.includes("schema cache")) {
      return NextResponse.json(
        { error: "SAI setting isn’t configured in the database yet. Apply migrations, then retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sai_enabled: upserted?.sai_enabled ?? saiEnabled, configured: true }, { status: 200 });
}
