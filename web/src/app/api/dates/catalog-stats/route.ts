import { type NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns daily aggregate stats for a playlist (defaults to all_catalog).
 * Each row = one date with streams, track counts, growth, etc.
 *
 * GET /api/dates/catalog-stats?playlist_key=<key>
 * Returns { rows: DateStatRow[], playlist_key: string }
 */
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) {
    return NextResponse.json({ error: adminErr.message }, { status: 500 });
  }
  if (!isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const playlistKey =
    req.nextUrl.searchParams.get("playlist_key")?.trim() || "all_catalog";

  const svc = supabaseService();

  const { data, error } = await svc
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_daily_net,missing_streams_track_count",
    )
    .eq("playlist_key", playlistKey)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data ?? []) as Array<{
    date: string;
    track_count: number;
    total_streams_cumulative: number;
    daily_streams_net: number | null;
    est_revenue_daily_net: number | null;
    missing_streams_track_count: number | null;
  }>;

  const rows = raw.map((r, idx) => {
    const prev = idx > 0 ? raw[idx - 1] : null;
    const dailyStreams = Number(r.daily_streams_net ?? 0);
    const prevDailyStreams = prev ? Number(prev.daily_streams_net ?? 0) : 0;
    const trackCount = Number(r.track_count ?? 0);
    const prevTrackCount = prev ? Number(prev.track_count ?? 0) : trackCount;

    const growthPct =
      prevDailyStreams > 0
        ? ((dailyStreams - prevDailyStreams) / prevDailyStreams) * 100
        : null;

    const tracksAdded = trackCount - prevTrackCount;

    const dayOfWeek = new Date(r.date + "T12:00:00Z").getUTCDay();

    return {
      date: r.date,
      daily_streams: dailyStreams,
      cumulative_streams: Number(r.total_streams_cumulative ?? 0),
      track_count: trackCount,
      growth_pct: growthPct != null ? Math.round(growthPct * 100) / 100 : null,
      tracks_added: tracksAdded,
      day_of_week: dayOfWeek,
      est_daily_revenue: r.est_revenue_daily_net != null ? Number(r.est_revenue_daily_net) : null,
      missing_streams_count:
        r.missing_streams_track_count != null
          ? Number(r.missing_streams_track_count)
          : 0,
    };
  });

  return NextResponse.json({ rows, playlist_key: playlistKey }, { status: 200 });
}
