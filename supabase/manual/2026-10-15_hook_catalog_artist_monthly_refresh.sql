-- Refresh the precomputed Catalog artist series from the shared post-ingest / post-override refresh point.
-- Same body as before; only the guarded call at the end is new. A failure there never fails the Home snapshots.
CREATE OR REPLACE FUNCTION public.refresh_home_diag_snapshots(p_run_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '150s'
AS $function$
DECLARE
  v_version text := public.spotibase_override_version();
  v_kind text;
  v_payload jsonb;
BEGIN
  IF p_run_date IS NULL THEN RAISE EXCEPTION 'run date is required'; END IF;
  FOREACH v_kind IN ARRAY ARRAY[
    'negative_daily_streams', 'artist_weekend_dips',
    'track_weekend_dips', 'artificial_stream_spikes'
  ] LOOP
    CASE v_kind
      WHEN 'negative_daily_streams' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM (SELECT * FROM public.home_negative_daily_streams() LIMIT 1000) r;
      WHEN 'artist_weekend_dips' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM (SELECT * FROM public.home_artist_weekend_dips(
          p_min_weekday_avg => 0, p_anchor_data_date => p_run_date - 2) LIMIT 1000) r;
      WHEN 'track_weekend_dips' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM (SELECT * FROM public.home_track_weekend_dips(
          p_min_weekday_avg => 0, p_anchor_data_date => p_run_date - 2) LIMIT 1000) r;
      WHEN 'artificial_stream_spikes' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM (SELECT * FROM public.home_artificial_stream_spikes(
          p_spike_ratio => 1.25, p_min_baseline => 50, p_grace_days => 14,
          p_threshold_crossing_max => 1500, p_include_weekends => false,
          p_start_date => p_run_date - 29, p_end_date => p_run_date) LIMIT 1000) r;
    END CASE;
    INSERT INTO public.home_diag_snapshots
      (run_date, kind, params_key, override_version, payload, computed_at)
    VALUES (p_run_date, v_kind, 'default', v_version, v_payload, statement_timestamp())
    ON CONFLICT (run_date, kind, params_key) DO UPDATE SET
      override_version = EXCLUDED.override_version, payload = EXCLUDED.payload,
      computed_at = EXCLUDED.computed_at;
  END LOOP;
  IF v_version IS DISTINCT FROM public.spotibase_override_version() THEN
    RAISE EXCEPTION 'overrides changed while refreshing Home diagnostics';
  END IF;
  DELETE FROM public.home_diag_snapshots
  WHERE run_date < p_run_date - 2;
  -- Precomputed Catalog artist series (hot window; widens itself when overrides changed).
  BEGIN
    PERFORM public.refresh_catalog_artist_monthly(p_run_date);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'catalog_artist_monthly refresh failed: %', SQLERRM;
  END;
END;
$function$;
