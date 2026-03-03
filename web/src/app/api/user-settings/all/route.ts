import { NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { DEFAULT_STALE_MIN_STREAMS, DEFAULT_CURRENCY } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns ALL user settings in a single response.
 * Context providers use a shared deduplicating fetch so that even if
 * multiple providers mount concurrently only one HTTP request is made.
 */
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
    .select(
      "stream_payout_rate_per_k_usd,currency_display,home_filters_enabled,home_custom_milestones_streams,chart_week_highlight_day,chart_start_date,chart_zoom_daily_y_axis,chart_zoom_daily_y_axis_collector_comparison,sai_enabled,stale_track_min_streams,stale_track_min_avg_daily,hide_stale_override_annotations",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      // Graceful fallback if table/column doesn't exist yet.
      return NextResponse.json({ configured: false }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = (settings ?? {}) as Record<string, unknown>;

  return NextResponse.json(
    {
      configured: true,
      stream_payout_rate_per_k_usd: row.stream_payout_rate_per_k_usd ?? 2.0,
      currency_display: row.currency_display ?? DEFAULT_CURRENCY,
      home_filters_enabled: row.home_filters_enabled ?? true,
      home_custom_milestones_streams: row.home_custom_milestones_streams ?? null,
      chart_week_highlight_day: row.chart_week_highlight_day ?? 0,
      chart_start_date: row.chart_start_date ?? null,
      chart_zoom_daily_y_axis: row.chart_zoom_daily_y_axis ?? true,
      chart_zoom_daily_y_axis_collector_comparison: row.chart_zoom_daily_y_axis_collector_comparison ?? true,
      sai_enabled: row.sai_enabled ?? true,
      stale_track_min_streams: row.stale_track_min_streams ?? DEFAULT_STALE_MIN_STREAMS,
      stale_track_min_avg_daily: row.stale_track_min_avg_daily ?? 10,
      hide_stale_override_annotations: row.hide_stale_override_annotations ?? false,
    },
    { status: 200 },
  );
}
