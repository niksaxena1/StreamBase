# Playlist Watch Operations

## Scope

Playlist Watch tracks daily follower counts for independent Spotify playlists that are not part of the own-catalog or competitor analytics universes.

Data lives in the `playlist_watch` schema. Do not write these playlists into `public.playlists` or `competitor.playlists`.

## Data Source

The first collector uses the free Spotify Web API `Get Playlist` endpoint and stores `followers.total` once per active playlist per day. Some public-looking playlists return `404` through Spotify's API; those stay on the watchlist but receive `last_check_status = 'spotify_404'`.

Future fallbacks, such as artist.tools scraping, should be added behind the collector/source boundary and continue writing the same `playlist_watch.follower_snapshots` rows.

## Daily Workflow

- `Spotify Playlist Watch Daily`
- Script: `scripts/collect_playlist_watch_followers.py`
- Alert script: `scripts/evaluate_playlist_watch_alerts.py`
- Schema: `playlist_watch`
- Source label: `spotify_api`

The workflow reads active rows from `playlist_watch.playlists`, fetches follower totals, upserts one snapshot per `(date, spotify_playlist_id)`, and records warnings without touching own-catalog or competitor jobs.

After collection, the workflow evaluates active rows in `playlist_watch.alert_rules`. Matching follower spikes send email to the rule's `recipient_email` and write `playlist_watch.alert_events` so a rule/playlist/date does not notify repeatedly.

These Playlist Watch alert emails are user-configurable product notifications. They are separate from existing CI/fix/failure emails, which continue to use `.github/actions/notify-email` with its existing default recipient.

Rules support:

- `min_absolute_jump`: current follower count minus the comparison-window average must be at least this value.
- `min_percent_jump`: the same jump must be at least this percentage above the comparison-window average.
- `comparison_window_days`: baseline window from 1 to 30 days, defaulting to 7.
- Optional playlist scope through `playlist_watch.alert_rule_playlists`; no scoped rows means all active watchlist playlists.

When both absolute and percentage thresholds are set, both must match. A rule needs a full baseline window plus the current run date before it can alert.

The `/playlist-watch` UI also includes:

- A test-email action in the alert editor, backed by `POST /api/playlist-watch/alerts/test-email`.
- A recent trigger preview for playlist-scoped rules, using the playlist's existing follower history before saving.
- An alert-history table mode that replaces the playlist table and shows all recent alert events for the signed-in user.
- Recent alert badges on playlist rows so users can jump from a playlist to alert history.

Example rule setup:

```sql
INSERT INTO playlist_watch.alert_rules (
  user_id,
  recipient_email,
  rule_name,
  min_absolute_jump,
  min_percent_jump,
  comparison_window_days
) VALUES (
  '<auth-user-id>',
  'alerts@example.com',
  'Large follower spike',
  500,
  25,
  7
);
```

## App Access

Access is controlled through `public.app_user_access`:

- `playlist_watch` allows viewing `/playlist-watch`.
- `playlist_watch_admin` allows adding, archiving, and unarchiving watchlist playlists.
- Existing admins can access Playlist Watch through `public.is_admin()`.

Watch-only users should not need normal StreamBase admin access.

## Archived Playlists

Removing a playlist from the active watchlist should archive it, not delete it. Archived playlists keep their historical snapshots and are hidden from `/playlist-watch` unless the archived filter is enabled.

## Demo playlist (local UI)

The watchlist row `MockWatchDemo00000001` ("DEMO - Follower Growth Playlist") uses deterministic mock follower history from `web/src/lib/playlistWatch/demoPlaylist.ts`. The page overrides DB snapshots for that ID so the chart can be exercised with negative daily deltas without reseeding Supabase. Edit that file to change the demo curve.
