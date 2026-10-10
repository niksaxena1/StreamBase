-- Playlist Watch user-configurable follower spike alerts.
-- Keeps alerting inside the isolated playlist_watch schema.

CREATE TABLE IF NOT EXISTS playlist_watch.alert_rules (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  rule_name TEXT NOT NULL DEFAULT 'Playlist follower spike',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  min_absolute_jump BIGINT CHECK (min_absolute_jump IS NULL OR min_absolute_jump > 0),
  min_percent_jump NUMERIC(8, 2) CHECK (min_percent_jump IS NULL OR min_percent_jump > 0),
  comparison_window_days INTEGER NOT NULL DEFAULT 7 CHECK (comparison_window_days BETWEEN 1 AND 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (recipient_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  CHECK (min_absolute_jump IS NOT NULL OR min_percent_jump IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS playlist_watch.alert_rule_playlists (
  rule_id BIGINT NOT NULL REFERENCES playlist_watch.alert_rules(id) ON DELETE CASCADE,
  spotify_playlist_id TEXT NOT NULL REFERENCES playlist_watch.playlists(spotify_playlist_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (rule_id, spotify_playlist_id)
);

CREATE TABLE IF NOT EXISTS playlist_watch.alert_events (
  id BIGSERIAL PRIMARY KEY,
  rule_id BIGINT REFERENCES playlist_watch.alert_rules(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  spotify_playlist_id TEXT REFERENCES playlist_watch.playlists(spotify_playlist_id) ON DELETE SET NULL,
  run_date DATE NOT NULL,
  baseline_count BIGINT NOT NULL,
  current_count BIGINT NOT NULL,
  absolute_jump BIGINT NOT NULL,
  percent_jump NUMERIC(10, 2),
  comparison_window_days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_id, spotify_playlist_id, run_date)
);

DROP TRIGGER IF EXISTS trg_playlist_watch_alert_rules_updated_at ON playlist_watch.alert_rules;
CREATE TRIGGER trg_playlist_watch_alert_rules_updated_at
  BEFORE UPDATE ON playlist_watch.alert_rules
  FOR EACH ROW EXECUTE FUNCTION playlist_watch.set_updated_at();

CREATE INDEX IF NOT EXISTS playlist_watch_alert_rules_user_active_idx
  ON playlist_watch.alert_rules (user_id, is_active, id);

CREATE INDEX IF NOT EXISTS playlist_watch_alert_rule_playlists_playlist_idx
  ON playlist_watch.alert_rule_playlists (spotify_playlist_id);

CREATE INDEX IF NOT EXISTS playlist_watch_alert_events_user_date_idx
  ON playlist_watch.alert_events (user_id, run_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS playlist_watch_alert_events_rule_date_idx
  ON playlist_watch.alert_events (rule_id, run_date DESC);

ALTER TABLE playlist_watch.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_watch.alert_rule_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_watch.alert_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages playlist watch alert rules" ON playlist_watch.alert_rules;
CREATE POLICY "service_role manages playlist watch alert rules"
  ON playlist_watch.alert_rules
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users manage own playlist watch alert rules" ON playlist_watch.alert_rules;
CREATE POLICY "Users manage own playlist watch alert rules"
  ON playlist_watch.alert_rules
  FOR ALL
  USING (auth.uid() = user_id AND public.can_access_playlist_watch())
  WITH CHECK (auth.uid() = user_id AND public.can_access_playlist_watch());

DROP POLICY IF EXISTS "service_role manages playlist watch alert rule playlists" ON playlist_watch.alert_rule_playlists;
CREATE POLICY "service_role manages playlist watch alert rule playlists"
  ON playlist_watch.alert_rule_playlists
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users manage own playlist watch alert rule playlists" ON playlist_watch.alert_rule_playlists;
CREATE POLICY "Users manage own playlist watch alert rule playlists"
  ON playlist_watch.alert_rule_playlists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM playlist_watch.alert_rules r
      WHERE r.id = alert_rule_playlists.rule_id
        AND r.user_id = auth.uid()
        AND public.can_access_playlist_watch()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM playlist_watch.alert_rules r
      WHERE r.id = alert_rule_playlists.rule_id
        AND r.user_id = auth.uid()
        AND public.can_access_playlist_watch()
    )
  );

DROP POLICY IF EXISTS "service_role manages playlist watch alert events" ON playlist_watch.alert_events;
CREATE POLICY "service_role manages playlist watch alert events"
  ON playlist_watch.alert_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own playlist watch alert events" ON playlist_watch.alert_events;
CREATE POLICY "Users read own playlist watch alert events"
  ON playlist_watch.alert_events
  FOR SELECT
  USING (auth.uid() = user_id AND public.can_access_playlist_watch());

GRANT ALL ON TABLE playlist_watch.alert_rules TO service_role;
GRANT ALL ON TABLE playlist_watch.alert_rule_playlists TO service_role;
GRANT ALL ON TABLE playlist_watch.alert_events TO service_role;
GRANT ALL ON SEQUENCE playlist_watch.alert_rules_id_seq TO service_role;
GRANT ALL ON SEQUENCE playlist_watch.alert_events_id_seq TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE playlist_watch.alert_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE playlist_watch.alert_rule_playlists TO authenticated;
GRANT SELECT ON TABLE playlist_watch.alert_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE playlist_watch.alert_rules_id_seq TO authenticated;

NOTIFY pgrst, 'reload schema';
