-- Prerequisite: 20261011023115_add_home_diagnostic_snapshots.sql.
-- Retain run_date >= p_run_date - 2, including the boundary day.
-- CREATE OR REPLACE preserves the service-role-only EXECUTE grants.

CREATE OR REPLACE FUNCTION public.refresh_home_diag_snapshots(p_run_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '150s'
AS $$
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
        FROM public.home_negative_daily_streams() r;
      WHEN 'artist_weekend_dips' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM public.home_artist_weekend_dips(
          p_min_weekday_avg => 0, p_anchor_data_date => p_run_date - 2) r;
      WHEN 'track_weekend_dips' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM public.home_track_weekend_dips(
          p_min_weekday_avg => 0, p_anchor_data_date => p_run_date - 2) r;
      WHEN 'artificial_stream_spikes' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM public.home_artificial_stream_spikes(
          p_spike_ratio => 1.25, p_min_baseline => 50, p_grace_days => 14,
          p_threshold_crossing_max => 1500, p_include_weekends => false,
          p_start_date => p_run_date - 29, p_end_date => p_run_date) r;
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
END;
$$;

CREATE OR REPLACE FUNCTION competitor.refresh_home_diag_snapshots(p_run_date date, p_label_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, competitor
SET statement_timeout = '150s'
AS $$
DECLARE
  v_label text := nullif(p_label_key, '__all');
  v_version text := competitor.spotibase_override_version();
  v_kind text;
  v_payload jsonb;
BEGIN
  IF p_run_date IS NULL THEN RAISE EXCEPTION 'run date is required'; END IF;
  FOREACH v_kind IN ARRAY ARRAY[
    'negative_daily_streams', 'artist_weekend_dips',
    'track_weekend_dips', 'artificial_stream_spikes', 'track_scatter_points_for_label'
  ] LOOP
    CASE v_kind
      WHEN 'negative_daily_streams' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM competitor.home_negative_daily_streams(p_label_key => v_label) r;
      WHEN 'artist_weekend_dips' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM competitor.home_artist_weekend_dips(
          p_min_weekday_avg => 0, p_anchor_snapshot_date => p_run_date,
          p_label_key => v_label) r;
      WHEN 'track_weekend_dips' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM competitor.home_track_weekend_dips(
          p_min_weekday_avg => 0, p_anchor_snapshot_date => p_run_date,
          p_label_key => v_label) r;
      WHEN 'artificial_stream_spikes' THEN
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM competitor.home_artificial_stream_spikes(
          p_spike_ratio => 1.25, p_min_baseline => 50, p_grace_days => 14,
          p_threshold_crossing_max => 1500, p_include_weekends => false,
          p_start_date => p_run_date - 29, p_end_date => p_run_date,
          p_label_key => v_label) r;
      WHEN 'track_scatter_points_for_label' THEN
        -- NULL is not an all-label scatter query. Home fans out by active label.
        IF v_label IS NULL THEN CONTINUE; END IF;
        SELECT coalesce(jsonb_agg(r), '[]'::jsonb) INTO v_payload
        FROM competitor.home_track_scatter_points_for_label(
          label_key => v_label, run_date => p_run_date, prev_date => p_run_date - 1) r;
    END CASE;
    INSERT INTO competitor.home_diag_snapshots
      (run_date, label_key, kind, params_key, override_version, payload, computed_at)
    VALUES (p_run_date, coalesce(v_label, '__all'), v_kind, 'default',
      v_version, v_payload, statement_timestamp())
    ON CONFLICT (run_date, label_key, kind, params_key) DO UPDATE SET
      override_version = EXCLUDED.override_version, payload = EXCLUDED.payload,
      computed_at = EXCLUDED.computed_at;
  END LOOP;
  IF v_version IS DISTINCT FROM competitor.spotibase_override_version() THEN
    RAISE EXCEPTION 'overrides changed while refreshing competitor Home diagnostics';
  END IF;
  DELETE FROM competitor.home_diag_snapshots
  WHERE run_date < p_run_date - 2;
END;
$$;
