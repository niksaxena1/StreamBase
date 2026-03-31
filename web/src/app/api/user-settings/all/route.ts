import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { DEFAULT_STALE_MIN_STREAMS, DEFAULT_CURRENCY } from "@/lib/constants";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data: settings, error } = await svc
    .from("user_settings")
    .select(
      "stream_payout_rate_per_k_usd,currency_display,home_filters_enabled,home_artificial_spikes_section_enabled,home_custom_milestones_streams,chart_week_highlight_day,chart_start_date,chart_zoom_daily_y_axis,chart_zoom_daily_y_axis_collector_comparison,sai_enabled,stale_track_min_streams,stale_track_min_avg_daily,hide_stale_override_annotations",
    )
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  const row = (settings ?? {}) as Record<string, unknown>;

  return apiJsonOk({
    configured: true as const,
    stream_payout_rate_per_k_usd: row.stream_payout_rate_per_k_usd ?? 2.0,
    currency_display: row.currency_display ?? DEFAULT_CURRENCY,
    home_filters_enabled: row.home_filters_enabled ?? true,
    home_artificial_spikes_section_enabled: row.home_artificial_spikes_section_enabled ?? true,
    home_custom_milestones_streams: row.home_custom_milestones_streams ?? null,
    chart_week_highlight_day: row.chart_week_highlight_day ?? 0,
    chart_start_date: row.chart_start_date ?? null,
    chart_zoom_daily_y_axis: row.chart_zoom_daily_y_axis ?? true,
    chart_zoom_daily_y_axis_collector_comparison: row.chart_zoom_daily_y_axis_collector_comparison ?? true,
    sai_enabled: row.sai_enabled ?? true,
    stale_track_min_streams: row.stale_track_min_streams ?? DEFAULT_STALE_MIN_STREAMS,
    stale_track_min_avg_daily: row.stale_track_min_avg_daily ?? 10,
    hide_stale_override_annotations: row.hide_stale_override_annotations ?? false,
  });
}
