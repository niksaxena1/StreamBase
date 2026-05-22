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
- Schema: `playlist_watch`
- Source label: `spotify_api`

The workflow reads active rows from `playlist_watch.playlists`, fetches follower totals, upserts one snapshot per `(date, spotify_playlist_id)`, and records warnings without touching own-catalog or competitor jobs.

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
