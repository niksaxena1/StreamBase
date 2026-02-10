import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_THRESHOLD = 2000;

function parseThreshold(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n))
    throw new Error("Threshold must be a whole number.");
  if (n < 0) throw new Error("Threshold must be non-negative.");
  return n;
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
    .select("stale_track_min_streams")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { stale_track_min_streams: DEFAULT_THRESHOLD, configured: false },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const val = Number(
    (settings as any)?.stale_track_min_streams ?? DEFAULT_THRESHOLD,
  );
  return NextResponse.json(
    {
      stale_track_min_streams: Number.isFinite(val) ? val : DEFAULT_THRESHOLD,
      configured: true,
    },
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
  let threshold: number;
  try {
    threshold = parseThreshold(
      (body as any)?.stale_track_min_streams ??
        (body as any)?.threshold ??
        (body as any)?.value,
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid threshold." },
      { status: 400 },
    );
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert(
      [{ user_id: user.id, stale_track_min_streams: threshold }],
      { onConflict: "user_id" },
    )
    .select("stale_track_min_streams")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        {
          error:
            "Stale threshold setting isn't configured in the database yet. Apply migrations, then retry.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const saved = Number(
    (upserted as any)?.stale_track_min_streams ?? threshold,
  );
  return NextResponse.json(
    {
      stale_track_min_streams: Number.isFinite(saved) ? saved : threshold,
      configured: true,
    },
    { status: 200 },
  );
}
