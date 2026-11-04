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

## Collections and ad status

Collections (`playlist_watch.collections`, members in `playlist_watch.collection_playlists`) group watched playlists, normally one collection per ad account. They are shared and read fresh (not through the 1h page cache). Service-role access only, behind `requirePlaylistWatchAccess`.

Each membership carries an optional ad status (`ad_status`, migration `20261102144740_playlist_watch_collection_ad_status.sql`):

- `live`: an ad currently promotes the playlist.
- `stopped`: its ads ended; `ad_status_changed_at` is when it stopped (the UI shows "Stopped since <date>").
- `null`: no status recorded.

Status is per collection membership, so the same playlist can be live in one account and stopped in another. Under the page's **All** chip a playlist counts as live if it is live in any collection, otherwise stopped if it is stopped in any.

API (`/api/playlist-watch/collections`):

- `GET` returns each collection with `playlistIds` (compat) and `members: [{ playlistId, adStatus, adStatusChangedAt }]`.
- `PUT /collections/<id>` takes `{ add?, remove?, status? }`. `status` is `[{ "playlist": "<spotify id|url|uri>", "ad_status": "live" | "stopped" | null }]`. The playlist must already be a member or be in `add` in the same request (new members default to `null`). `ad_status_changed_at` is set to now only when the status actually changes (clearing it sets the timestamp to null); resending the same status leaves it alone. Invalid ids/values return 400 (`invalid_status_update`, `not_a_member`, `status_for_removed_playlist`).

The daily ads job should set statuses with that `PUT` call.

Page URL params: `?collection=<id|all|unassigned>` and `?status=all|live|stopped` (default `all`, unknown values fall back to `all`; ignored for Unassigned and the archived view). Collections with no non-archived members get no chip.

## Archived Playlists

Removing a playlist from the active watchlist should archive it, not delete it. Archived playlists keep their historical snapshots and are hidden from `/playlist-watch` unless the archived filter is enabled.

## Demo playlist (local UI)

The watchlist row `MockWatchDemo00000001` ("DEMO - Follower Growth Playlist") uses deterministic mock follower history from `web/src/lib/playlistWatch/demoPlaylist.ts`. The page overrides DB snapshots for that ID so the chart can be exercised with negative daily deltas without reseeding Supabase. Edit that file to change the demo curve.

## Track streams (`/playlist-watch/upload`)

Daily Spotify play counts for every track of selected playlists, first the owner's "upload" playlist (`39VN40Aa1bTQEtkuo0HOjD`, tracks by other artists, changed mostly on Fridays). Separate from the follower watchlist above and from all own-catalog/competitor stream data; no SpotOnTrack dashboard involved.

- Tables (migration `20261104174153_playlist_watch_track_streams.sql`, service-role only): `track_watch_playlists` (config; `slug` names the page, `removed_retention_days` default 30), `track_watch_tracks`, `track_watch_memberships` (`first_seen_date`, `removed_date`; a re-added track clears `removed_date` and keeps `first_seen_date`), `track_watch_stream_snapshots` (one row per track per day).
- Page data: RPC `playlist_watch.track_watch_rows(p_slug)` (latest play count, baselines 1/7/28 days back, first snapshot since added, 60-day history).
- Workflow `Playlist Watch Track Streams Daily` (`playlist_watch_track_streams_daily.yml`), dispatched by pg_cron job `streambase-playlist-watch-tracks` at 14:20 UTC. Script `scripts/collect_playlist_watch_track_streams.py`.
- Membership comes from the Spotify Web API (client credentials). Play counts come from the web player's `getTrack` GraphQL query (`api-partner.spotify.com/pathfinder`) with the anonymous token on the public playlist embed page: free, no RapidAPI/artist.tools quota.
- If every play-count call fails, Spotify probably rotated the persisted-query hash: copy the current `getTrack` `sha256Hash` from open.spotify.com network traffic into the repo variable `PLAYCOUNT_QUERY_HASH`.
- Removed tracks keep being collected for `removed_retention_days` and show in the page's Removed section.
- Add another playlist: insert a `track_watch_playlists` row (id + slug); the page currently reads slug `upload`.

### Beatport link (upload candidates)

The upload page also reads the Beatport chart tracker (`charts` schema) by ISRC, read-only, to help pick what to post on YouTube (migrations `20261104190543_playlist_watch_upload_beatport_link.sql`, `20261104192216_playlist_watch_upload_beatport_spotify_match.sql`).

- `playlist_watch.track_watch_chart_positions(p_slug)`: Beatport rank today, rank on the reference Friday, best rank and days on chart for upload tracks (current and removed), last 60 days.
- `playlist_watch.track_watch_chart_candidates(p_slug)`: tracks on each active chart's latest snapshot that are not in the playlist, with Spotify play counts and 60-day history.
- `playlist_watch.track_watch_isrc_map`: Beatport ISRC -> Spotify track id. Beatport usually lists the extended mix under its own ISRC, so the collector tries Spotify search `isrc:` first (`status = ok`), then title + first artist (`name_match`: same base title, a shared artist, same remix; same ISRC registrant+year wins ties). Misses (`not_found`/`error`) are re-checked after 7 days. Both RPCs match upload tracks by ISRC or through this map.
- Chart tracks' play counts are collected by the same daily job (step after the playlist; `--skip-charts` turns it off) into the same `track_watch_tracks` / `track_watch_stream_snapshots` tables.
