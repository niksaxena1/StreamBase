# Health Events

The admin-only Health page retains its existing layout and adds a collapsed Events section below warning history. Expanding it requests `/api/health-events`; a remembered-open section loads after hydration through an open-state effect. The initial server render performs no Events reads. The list defaults to 30 UTC calendar days including today, with 7/30/90-day windows and event-type filters.

Own-catalog Events read only `public` analytics tables. Competitor Events read only `competitor` analytics tables and scope tracks through active playlists for the selected label (or all active competitor playlists for All competitors). Admin/session and dataset checks happen before loaders or cached analytics reads. Competitor ingestion runs are marked at the schema/pipeline level because a single run ingests all configured labels.

| Event | Source / grouping |
| --- | --- |
| Takedown / restoration | Own-only `spotify_track_availability_events.detected_at`; suppressed transitions remain visible with “already dead in StreamBase” |
| New track | `tracks.first_seen`; competitor tracks must have a selected-label membership on that date |
| Playlist additions / removals | `playlist_memberships.valid_from` / `valid_to + 1`; `valid_to` is the last active day. Grouped by date, playlist and direction, with distinct ISRC counts and expandable track links |
| Stream overrides | `track_daily_stream_overrides.date`, grouped by snapshot date and note prefix; `stale-fix` preserves the provider name. These are current stored corrections, not an immutable audit of overwritten/deleted rows |
| Ingestion | `ingestion_runs.run_date` and status; failures highlighted, with logs links |
| Large movement / partial data | One `health_daily_stream_totals` RPC in the current schema, returning like-for-like daily streams and track coverage counts |

The date column displays data dates for SOT snapshots, discoveries, playlist changes and corrections, applying the same two-day run-to-data-date conversion as other analytics. Real-time Spotify takedowns/restorations retain their actual UTC detection date. Ingestion rows explicitly show `run <date>`. Windows and sorting use displayed dates. Removal queries select last-active dates in `[snapshot start - 1, snapshot end - 1]` before advancing them one day. The header notes: “Streams lag SpotOnTrack by ~2 days, so the newest 1–2 days have no movement data yet.”

The RPC resolves a distinct ISRC array, reads base snapshots and overrides directly with `isrc = ANY(array)` and bounded date predicates, and gives overrides precedence in a full join. For each D it counts prior-day ISRCs with non-null values as `tracks_expected`; pairs with a non-null value on D are `tracks_counted`. Daily streams sum `max(0, value(D) - value(D-1))` over those pairs only. New counters do not inflate totals, missing pairs do not fabricate deltas, and resets/takedowns never subtract from streams. The competitor cohort is fixed across the requested interval, includes ISRCs whose memberships overlap it in active playlists/labels, and deduplicates shared playlists. NULL label selects all active labels.

Each Events cache fill calls the totals RPC once, requesting eight extra baseline daily totals and stopping at today's run date. SQL reads one additional seed snapshot day for differencing. A day with coverage below 90% is shown as “Partial data” and excluded from the movement baseline. The detector compares a complete day with the previous seven complete observations available in the bounded response, requires a positive median, and flags absolute changes strictly greater than 35%. A zero expected-track count supplies no observation; insufficient complete history produces no movement alert.

Event queries paginate past the PostgREST row cap with stable ordering; only competitor discovery/repair queries batch ISRC filters. No loader pages stream snapshots. Versioned loader caches include dataset, label and window, with `supabase` and `health` tags and a one-hour TTL. Errors produce a retryable message rather than partial event counts or a snapshot-paging fallback.

Owner rollout prerequisite: apply `supabase/migrations/20261011194159_add_health_daily_movement_rpcs.sql` before deploying these loader changes. It creates/replaces only the two read-only functions, with STABLE, SECURITY INVOKER, an empty search path, a 30-second statement timeout, and execute grants only for `service_role` (PUBLIC/anon/authenticated revoked). Both stream/override foundations and competitor config tables must already exist. The migration has not been applied by this implementation; no database writes were made. Until the owner applies it, Events will report a missing-RPC error.
