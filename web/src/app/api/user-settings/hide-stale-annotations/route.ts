import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_HIDE = false;

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("hide_stale_override_annotations")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { hide_stale_override_annotations: DEFAULT_HIDE, configured: false },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const val = (settings as Record<string, unknown>)?.hide_stale_override_annotations;

  return NextResponse.json(
    {
      hide_stale_override_annotations: typeof val === "boolean" ? val : DEFAULT_HIDE,
      configured: true,
    },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = body.hide_stale_override_annotations ?? body.enabled;
  let enabled: boolean;
  if (typeof raw === "boolean") {
    enabled = raw;
  } else {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "true" || s === "1") enabled = true;
    else if (s === "false" || s === "0") enabled = false;
    else return NextResponse.json({ error: "Value must be a boolean." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert(
      [{ user_id: user.id, hide_stale_override_annotations: enabled }],
      { onConflict: "user_id" },
    )
    .select("hide_stale_override_annotations")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { error: "Setting isn't configured in the database yet. Apply migrations, then retry." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const saved = (upserted as Record<string, unknown>)?.hide_stale_override_annotations;

  return NextResponse.json(
    {
      hide_stale_override_annotations: typeof saved === "boolean" ? saved : enabled,
      configured: true,
    },
    { status: 200 },
  );
}
