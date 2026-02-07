/**
 * Shared deduplicating fetch for user settings.
 *
 * Multiple React context providers each need a subset of user_settings.
 * Rather than each provider issuing its own HTTP request on mount
 * (which all happen simultaneously during page load), they all call
 * `fetchUserSettingsBundle()` and share a single in-flight request.
 *
 * After the request resolves, the cache is cleared after a short delay
 * so that a subsequent `refetch()` (e.g. after a settings page change)
 * will issue a fresh request.
 */

export type UserSettingsBundle = {
  configured: boolean;
  stream_payout_rate_per_k_usd: number;
  currency_display: string;
  home_filters_enabled: boolean;
  home_custom_milestones_streams: string | null;
  chart_week_highlight_day: number;
  chart_start_date: string | null;
  chart_zoom_daily_y_axis: boolean;
  chart_zoom_daily_y_axis_collector_comparison: boolean;
  sai_enabled: boolean;
};

let pending: Promise<UserSettingsBundle> | null = null;

export function fetchUserSettingsBundle(): Promise<UserSettingsBundle> {
  if (pending) return pending;

  pending = fetch("/api/user-settings/all", { method: "GET" })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error ?? "Failed to load settings");
      return data as UserSettingsBundle;
    })
    .finally(() => {
      // Clear after a short delay so concurrent callers that arrive within
      // the same microtask still share the request, but later refetches
      // (triggered by settings changes) get a fresh request.
      setTimeout(() => {
        pending = null;
      }, 100);
    });

  return pending;
}

/**
 * Force-clear the cached promise so the next call issues a fresh request.
 * Useful when a context's refetch() is triggered by a settings update.
 */
export function invalidateUserSettingsBundle(): void {
  pending = null;
}
