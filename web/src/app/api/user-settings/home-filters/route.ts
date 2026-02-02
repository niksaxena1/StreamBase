import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSchemaMissing(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column");
}

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
    .select("home_filters_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      // Graceful fallback if table/column doesn't exist yet.
      return NextResponse.json({ home_filters_enabled: true, configured: false }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const enabled = (settings as any)?.home_filters_enabled;
  return NextResponse.json(
    { home_filters_enabled: enabled === undefined || enabled === null ? true : Boolean(enabled), configured: true },
    { status: 200 },
  );
}

export async function POST(request: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const enabled = Boolean((body as any)?.home_filters_enabled);

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, home_filters_enabled: enabled }], { onConflict: "user_id" })
    .select("home_filters_enabled")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        {
          error:
            "Home Filters setting isn’t configured in the database yet. Add the `home_filters_enabled` column to `user_settings`, then retry.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { home_filters_enabled: (upserted as any)?.home_filters_enabled ?? enabled, configured: true },
    { status: 200 },
  );
}

