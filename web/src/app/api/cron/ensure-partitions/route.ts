import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";

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
    return apiJsonErr("unauthorized", 401);
  }

  const monthsAhead = Math.min(
    24,
    Math.max(1, Number(new URL(req.url).searchParams.get("months_ahead")) || 6),
  );

  try {
    const svc = supabaseService();
    const { error } = await svc.rpc("ensure_track_daily_streams_partitions", {
      months_ahead: monthsAhead,
    });

    if (error) {
      console.error("ensure_track_daily_streams_partitions failed:", error);
      return apiJsonErr(error.message, 500);
    }

    return apiJsonOk({
      message: `Ensured partitions for the next ${monthsAhead} months.`,
    });
  } catch (e) {
    console.error("ensure-partitions cron error:", e);
    return apiJsonErr(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
