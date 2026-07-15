import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";
import { timingSafeEqualStrings } from "@/lib/api/internalAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function getCronSecret(): string | null {
  return process.env.CRON_SECRET ?? null;
}

function isAuthorized(req: Request): boolean {
  const secret = getCronSecret();
  if (!secret) {
    // A missing secret silently disables partition creation; make it loud so
    // it is caught before inserts start failing months later.
    console.error("CRON_SECRET is not set; refusing cron request. Partition maintenance is disabled until it is configured.");
    return false;
  }
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) return false;
  return timingSafeEqualStrings(auth.slice(7).trim(), secret.trim());
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

    // Monthly housekeeping piggybacked on the same cron: web performance
    // metrics are 20%-sampled per page view and would otherwise grow forever.
    // Percentile reviews only look at recent windows, so keep 180 days.
    const metricsCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const { error: metricsErr } = await svc
      .from("web_performance_metrics")
      .delete()
      .lt("recorded_at", metricsCutoff);
    if (metricsErr) {
      // Non-fatal: partitions are the critical part of this cron.
      console.error("web_performance_metrics retention cleanup failed:", metricsErr);
    }

    return apiJsonOk({
      message: `Ensured partitions for the next ${monthsAhead} months.`,
      metricsRetention: metricsErr ? `cleanup failed: ${metricsErr.message}` : `pruned metrics older than ${metricsCutoff.slice(0, 10)}`,
    });
  } catch (e) {
    console.error("ensure-partitions cron error:", e);
    return apiJsonErr(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
