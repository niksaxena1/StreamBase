"""Global estimated-payout rate for StreamBase ingestion.

The rate ($ per stream) used to precompute `playlist_daily_stats.est_revenue_*`
lives in `public.health_config` under `stream_payout_usd_per_stream`, so it can
be changed without a deploy and stays in sync with the SQL recompute functions
(`public.spotibase_stream_payout_rate()`).

This is the GLOBAL ingest-time rate. What the web app displays comes from the
per-user setting `user_settings.stream_payout_rate_per_k_usd` (Settings page).
"""

DEFAULT_STREAM_PAYOUT_USD = 0.002
HEALTH_CONFIG_KEY = "stream_payout_usd_per_stream"


def load_stream_payout_usd(pg, default: float = DEFAULT_STREAM_PAYOUT_USD) -> float:
    """Read the rate from public.health_config, falling back to `default`.

    `pg` must be a PUBLIC-schema Postgrest client (health_config lives in
    public, so a competitor-profile client will not find it).
    """
    try:
        rows = pg.select("health_config", "value_numeric", f"key=eq.{HEALTH_CONFIG_KEY}")
        if rows:
            value = rows[0].get("value_numeric")
            if value is not None:
                rate = float(value)
                if rate > 0:
                    return rate
        print(f"[rate] {HEALTH_CONFIG_KEY} not configured; using default {default}")
    except Exception as e:
        print(f"[rate] could not read {HEALTH_CONFIG_KEY} ({e}); using default {default}")
    return default
