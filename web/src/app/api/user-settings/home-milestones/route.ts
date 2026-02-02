import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isSchemaMissing(err: unknown) {
  const msg = String((err as any)?.message ?? "");
  return msg.includes("Could not find the table") || msg.includes("schema cache") || msg.includes("column");
}

function normalizeCsv(raw: unknown): string | null {
  if (raw === null) return null;
  if (raw === undefined) return null;
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Expect comma-separated integers (streams), min 100k.
  const parts = s
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new Error("Milestones must be comma-separated whole numbers.");
    const n = Number(p);
    if (!Number.isFinite(n) || n < 100_000) throw new Error("Minimum milestone is 100000 streams.");
    nums.push(Math.round(n));
  }

  const uniqDesc = Array.from(new Set(nums)).sort((a, b) => b - a);
  return uniqDesc.length ? uniqDesc.join(",") : null;
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
    .select("home_custom_milestones_streams")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json({ home_custom_milestones_streams: null, configured: false }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      home_custom_milestones_streams: (settings as any)?.home_custom_milestones_streams ?? null,
      configured: true,
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user;
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  let csv: string | null;
  try {
    csv = normalizeCsv((body as any)?.home_custom_milestones_streams ?? (body as any)?.milestones_csv);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid milestones." }, { status: 400 });
  }

  const svc = supabaseService();
  const { data: upserted, error } = await svc
    .from("user_settings")
    .upsert([{ user_id: user.id, home_custom_milestones_streams: csv }], { onConflict: "user_id" })
    .select("home_custom_milestones_streams")
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        {
          error:
            "Home milestones setting isn’t configured in the database yet. Add the `home_custom_milestones_streams` column to `user_settings`, then retry.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { home_custom_milestones_streams: (upserted as any)?.home_custom_milestones_streams ?? csv, configured: true },
    { status: 200 },
  );
}

