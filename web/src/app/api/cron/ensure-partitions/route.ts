import { NextResponse } from "next/server";

import { supabaseService } from "@/lib/supabase/service";

/**
 * Cron endpoint: ensures monthly partitions exist for track_daily_streams
 * so ETL can insert data for future months. Call monthly (e.g. 1st of month).
 *
 * Secured by CRON_SECRET: send Authorization: Bearer <CRON_SECRET>.
 * Set CRON_SECRET in Vercel (and .env.local for local testing).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function getCronSecret(): string | null {
  return process.env.CRON_SECRET ?? null;
}

function isAuthorized(req: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return auth.slice(7).trim() === secret.trim();
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const monthsAhead = Math.min(
    24,
    Math.max(1, Number(new URL(req.url).searchParams.get("months_ahead")) || 6)
  );

  try {
    const svc = supabaseService();
    const { error } = await svc.rpc("ensure_track_daily_streams_partitions", {
      months_ahead: monthsAhead,
    });

    if (error) {
      console.error("ensure_track_daily_streams_partitions failed:", error);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Ensured partitions for the next ${monthsAhead} months.`,
    });
  } catch (e) {
    console.error("ensure-partitions cron error:", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
