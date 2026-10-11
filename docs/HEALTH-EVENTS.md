# Health Events

The admin-only Health page retains its existing layout and adds a collapsed Events section below warning history. Expanding it requests `/api/health-events`; the initial server render performs no Events reads. The list defaults to 30 UTC calendar days including today, with 7/30/90-day windows and event-type filters.

Own-catalog Events read only `public` analytics tables. Competitor Events read only `competitor` analytics tables and scope tracks through active playlists for the selected label (or all active competitor playlists for All competitors). Admin/session and dataset checks happen before loaders or cached analytics reads. Competitor ingestion runs are marked at the schema/pipeline level because a single run ingests all configured labels.

| Event | Source / grouping |
| --- | --- |
| Takedown / restoration | Own-only `spotify_track_availability_events.detected_at`; suppressed transitions remain visible with “already dead in StreamBase” |
| New track | `tracks.first_seen`; competitor tracks must have a selected-label membership on that date |
| Playlist additions / removals | `playlist_memberships.valid_from` / `valid_to`, grouped by UTC date, playlist and direction, with distinct ISRC counts and expandable track links |
| Stream overrides | `track_daily_stream_overrides.date`, grouped by snapshot date and note prefix; `stale-fix` preserves the provider name. These are current stored corrections, not an immutable audit of overwritten/deleted rows |
| Ingestion | `ingestion_runs.run_date` and status; failures highlighted, with logs links |
| Large movement | `track_daily_streams_effective_public` cumulative counters, including overrides, differenced per ISRC against the previous calendar date and summed once per ISRC |

Events show stored dates (UTC), rather than applying the stream-data lag to transitions, memberships or corrections. Stream reads cover only the requested window plus eight preceding snapshot days: one for differencing and seven daily totals for the initial median. Only movements inside the requested window appear. The detector requires all seven prior calendar-day totals, a positive median and an absolute change strictly greater than 35%. Missing snapshot pairs do not create a delta; newly seen counters are not treated as daily streams. No gap is bridged or zero-filled.

Queries paginate past the PostgREST row cap and use stable ordering. Stream queries use date/ISRC cursors to avoid growing database offsets. Pages are folded server-side while retaining two days of counters; competitor ISRC filters are batched to keep URLs bounded and isolate labels. Loader caches include dataset, label and window, with existing `supabase` and `health` tags and a one-hour TTL. Errors produce a retryable message, not partial event counts. No migrations or database writes are required.
