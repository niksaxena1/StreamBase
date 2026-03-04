import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_ENABLED = true;
const DEFAULT_DAILY_CAP = 20;
const MAX_DAILY_CAP = 1000;

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select("rapidapi_auto_fix_enabled, rapidapi_auto_fix_daily_cap")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        {
          rapidapi_auto_fix_enabled: DEFAULT_ENABLED,
          rapidapi_auto_fix_daily_cap: DEFAULT_DAILY_CAP,
          configured: false,
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = settings as Record<string, unknown> | null;
  const enabled = row?.rapidapi_auto_fix_enabled;
  const cap = row?.rapidapi_auto_fix_daily_cap;

  return NextResponse.json(
    {
      rapidapi_auto_fix_enabled: typeof enabled === "boolean" ? enabled : DEFAULT_ENABLED,
      rapidapi_auto_fix_daily_cap: typeof cap === "number" ? cap : DEFAULT_DAILY_CAP,
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

  const patch: Record<string, unknown> = { user_id: user.id };

  // Handle enabled toggle
  if (body.rapidapi_auto_fix_enabled !== undefined) {
    const raw = body.rapidapi_auto_fix_enabled;
    if (typeof raw === "boolean") {
      patch.rapidapi_auto_fix_enabled = raw;
    } else {
      const s = String(raw ?? "").trim().toLowerCase();
      if (s === "true" || s === "1") patch.rapidapi_auto_fix_enabled = true;
      else if (s === "false" || s === "0") patch.rapidapi_auto_fix_enabled = false;
      else return NextResponse.json({ error: "rapidapi_auto_fix_enabled must be a boolean." }, { status: 400 });
    }
  }

  // Handle daily cap
  if (body.rapidapi_auto_fix_daily_cap !== undefined) {
    const raw = Number(body.rapidapi_auto_fix_daily_cap);
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_DAILY_CAP) {
      return NextResponse.json(
        { error: `rapidapi_auto_fix_daily_cap must be an integer between 1 and ${MAX_DAILY_CAP}.` },
        { status: 400 },
      );
    }
    patch.rapidapi_auto_fix_daily_cap = raw;
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "No recognised field provided." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([patch], { onConflict: "user_id" })
    .select("rapidapi_auto_fix_enabled, rapidapi_auto_fix_daily_cap")
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

  const row = upserted as Record<string, unknown> | null;
  const savedEnabled = row?.rapidapi_auto_fix_enabled;
  const savedCap = row?.rapidapi_auto_fix_daily_cap;

  return NextResponse.json(
    {
      rapidapi_auto_fix_enabled: typeof savedEnabled === "boolean" ? savedEnabled : (patch.rapidapi_auto_fix_enabled ?? DEFAULT_ENABLED),
      rapidapi_auto_fix_daily_cap: typeof savedCap === "number" ? savedCap : (patch.rapidapi_auto_fix_daily_cap ?? DEFAULT_DAILY_CAP),
      configured: true,
    },
    { status: 200 },
  );
}
