import { supabaseService } from "@/lib/supabase/service";
import { getActiveWarningSummary } from "./activeWarnings";
import type {
  TrackBase,
  StaleTrack,
  DecreasedTrack,
  RemovedTrack,
  PrevNonzeroTrack,
  ExcludedZeroedTrack,
  NegativeDailyStreamTrack,
  DriftTrack,
  DriftData,
  OverlapTrack,
  SwingTracks,
  MissingCatalogTrack,
  PlaylistMeta,
  WarningRow,
  WarningExpandedData,
  DisplayedWarning,
  MissingEnrichmentDetailsJson,
  CatalogMissingSnapshotsDetailsJson,
  PrevNonzeroDetailsJson,
  IndividualTracksStaleDetailsJson,
  ExcludedTrackZeroedDetailsJson,
  TotalStreamsDecreasedDetailsJson,
} from "./types";
import { normalizeIsrc, normalizeKey } from "./types";
import { logError } from "@/lib/logger";

type Svc = ReturnType<typeof supabaseService>;

// ---------------------------------------------------------------------------
// Exclusion helpers
// ---------------------------------------------------------------------------

type ExclusionSets = {
  ncGlobal: Set<string>;
  ncByPlaylist: Map<string, Set<string>>;
  enrGlobal: Set<string>;
  enrByPlaylist: Map<string, Set<string>>;
};

async function loadExclusions(svc: Svc): Promise<ExclusionSets> {
  const excl: ExclusionSets = {
    ncGlobal: new Set(),
    ncByPlaylist: new Map(),
    enrGlobal: new Set(),
    enrByPlaylist: new Map(),
  };

  try {
    const [{ data: ncRows }, { data: enrRows }] = await Promise.all([
      svc
        .from("health_warning_exclusions")
        .select("playlist_key,isrc")
        .eq("code", "non_catalog_tracks_present")
        .limit(2000),
      svc
        .from("health_warning_exclusions")
        .select("playlist_key,isrc")
        .eq("code", "tracks_missing_enrichment")
        .limit(2000),
    ]);

    for (const r of (ncRows ?? []) as Array<Record<string, unknown>>) {
      const isrc = normalizeIsrc(r.isrc);
      const pk = normalizeKey(r.playlist_key as string);
      if (!isrc) continue;
      if (!pk) {
        excl.ncGlobal.add(isrc);
      } else {
        if (!excl.ncByPlaylist.has(pk)) excl.ncByPlaylist.set(pk, new Set());
        excl.ncByPlaylist.get(pk)!.add(isrc);
      }
    }

    for (const r of (enrRows ?? []) as Array<Record<string, unknown>>) {
      const isrc = normalizeIsrc(r.isrc);
      const pk = normalizeKey(r.playlist_key as string);
      if (!isrc) continue;
      if (!pk) {
        excl.enrGlobal.add(isrc);
      } else {
        if (!excl.enrByPlaylist.has(pk))
          excl.enrByPlaylist.set(pk, new Set());
        excl.enrByPlaylist.get(pk)!.add(isrc);
      }
    }
  } catch {
    // Table may not exist yet
  }

  return excl;
}

function isExcludedNc(excl: ExclusionSets, pk: string, isrc: string): boolean {
  if (!isrc) return false;
  if (excl.ncGlobal.has(isrc)) return true;
  const s = excl.ncByPlaylist.get(pk);
  return Boolean(s?.has(isrc));
}

function isExcludedEnr(
  excl: ExclusionSets,
  pk: string,
  isrc: string,
): boolean {
  if (!isrc) return false;
  if (excl.enrGlobal.has(isrc)) return true;
  const s = excl.enrByPlaylist.get(pk);
  return Boolean(s?.has(isrc));
}

function ncExclusionsEnabled(excl: ExclusionSets): boolean {
  return excl.ncGlobal.size > 0 || excl.ncByPlaylist.size > 0;
}

// ---------------------------------------------------------------------------
// Generic details_json → tracks table fetcher (#2: deduplicated pattern)
//
// Batches ALL ISRCs across all warnings of the same code into ONE query,
// then distributes results back. This also addresses #4 (parallelise
// remaining sequential fetches) by replacing per-warning for…of loops.
// ---------------------------------------------------------------------------

type TrackSample = { isrc: string; [key: string]: unknown };

async function fetchDetailsTracks(
  svc: Svc,
  warnings: WarningRow[],
  extractSamples: (
    dj: Record<string, unknown> | null,
  ) => TrackSample[],
): Promise<Map<string, Array<TrackBase & Record<string, unknown>> | null>> {
  const result = new Map<
    string,
    Array<TrackBase & Record<string, unknown>> | null
  >();
  const samplesByKey = new Map<string, TrackSample[]>();
  const allIsrcs = new Set<string>();

  for (const w of warnings) {
    const key = String(w.playlist_key ?? "global");
    const samples = extractSamples(w.details_json);
    if (samples.length === 0) {
      result.set(key, null);
      continue;
    }
    samplesByKey.set(key, samples);
    for (const s of samples) allIsrcs.add(s.isrc);
  }

  if (allIsrcs.size === 0) return result;

  const { data: trackRows, error } = await svc
    .from("tracks")
    .select(
      "isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url",
    )
    .in("isrc", [...allIsrcs]);

  if (error) {
    for (const key of samplesByKey.keys()) result.set(key, null);
    return result;
  }

  const metaByIsrc = new Map<string, TrackBase>();
  for (const t of (trackRows ?? []) as Array<Record<string, unknown>>) {
    const isrc = normalizeIsrc(t.isrc);
    metaByIsrc.set(isrc, {
      isrc,
      name: (t.name ?? null) as string | null,
      artist_names: (t.spotify_artist_names ?? null) as string[] | null,
      artist_ids: (t.spotify_artist_ids ?? null) as string[] | null,
      album_image_url: (t.spotify_album_image_url ?? null) as string | null,
    });
  }

  for (const [key, samples] of samplesByKey) {
    const tracks = samples.map((s) => {
      const { isrc, ...extra } = s;
      const meta = metaByIsrc.get(isrc);
      return {
        isrc,
        name: meta?.name ?? null,
        artist_names: meta?.artist_names ?? null,
        artist_ids: meta?.artist_ids ?? null,
        album_image_url: meta?.album_image_url ?? null,
        ...extra,
      };
    });
    result.set(key, tracks);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Per-warning-type sample extractors (used with fetchDetailsTracks)
// ---------------------------------------------------------------------------

function extractCatalogMissing(
  dj: Record<string, unknown> | null,
): TrackSample[] {
  const details = dj as CatalogMissingSnapshotsDetailsJson | null;
  const raw = details?.missing_isrcs_sample;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((x) => ({ isrc: normalizeIsrc(x) }))
    .filter((r) => Boolean(r.isrc))
    .slice(0, 200);
}

function extractPrevNonzero(
  dj: Record<string, unknown> | null,
): TrackSample[] {
  const details = dj as PrevNonzeroDetailsJson | null;
  const raw = details?.affected_isrcs_with_prev_sample;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => {
      const isrc = normalizeIsrc(r.isrc);
      const prev = Number(r.prev_streams_cumulative ?? NaN);
      return {
        isrc,
        prev_streams_cumulative: Number.isFinite(prev) ? prev : null,
      };
    })
    .filter((r) => Boolean(r.isrc))
    .slice(0, 200);
}

function extractStale(
  dj: Record<string, unknown> | null,
): TrackSample[] {
  const details = dj as IndividualTracksStaleDetailsJson | null;
  const raw = details?.affected_tracks;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => {
      const isrc = normalizeIsrc(r.isrc);
      const streams = Number(r.streams_cumulative ?? NaN);
      return {
        isrc,
        streams_cumulative: Number.isFinite(streams) ? streams : null,
      };
    })
    .filter((r) => Boolean(r.isrc))
    .slice(0, 200);
}

function extractExcludedZeroed(
  dj: Record<string, unknown> | null,
): TrackSample[] {
  const details = dj as ExcludedTrackZeroedDetailsJson | null;
  const raw = details?.affected_tracks;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => {
      const isrc = normalizeIsrc(r.isrc);
      const prev = Number(r.prev_streams ?? NaN);
      return { isrc, prev_streams: Number.isFinite(prev) ? prev : null };
    })
    .filter((r) => Boolean(r.isrc))
    .slice(0, 200);
}

function extractDecreased(
  dj: Record<string, unknown> | null,
): TrackSample[] {
  const details = dj as TotalStreamsDecreasedDetailsJson | null;
  const raw = details?.decreased_tracks;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => {
      const isrc = normalizeIsrc(r.isrc);
      const prev = Number(r.prev_streams ?? NaN);
      const today = Number(r.today_streams ?? NaN);
      const delta = Number(r.delta ?? NaN);
      return {
        isrc,
        prev_streams: Number.isFinite(prev) ? prev : null,
        today_streams: Number.isFinite(today) ? today : null,
        delta: Number.isFinite(delta) ? delta : null,
      };
    })
    .filter((r) => Boolean(r.isrc))
    .slice(0, 200);
}

function extractRemoved(
  dj: Record<string, unknown> | null,
): TrackSample[] {
  const details = dj as TotalStreamsDecreasedDetailsJson | null;
  const raw = details?.removed_tracks;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => {
      const isrc = normalizeIsrc(r.isrc);
      const prev = Number(r.prev_streams ?? NaN);
      return {
        isrc,
        prev_streams: Number.isFinite(prev) ? prev : null,
      };
    })
    .filter((r) => Boolean(r.isrc))
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// RPC-based fetchers (non_catalog, swing, enrichment, drift, overlap)
// ---------------------------------------------------------------------------

async function fetchNonCatalogTracks(
  svc: Svc,
  warnings: WarningRow[],
  runDate: string,
  excl: ExclusionSets,
): Promise<Map<string, TrackBase[]>> {
  const result = new Map<string, TrackBase[]>();
  const enabled = ncExclusionsEnabled(excl);

  await Promise.all(
    warnings.map(async (w) => {
      if (!w.playlist_key) return;
      try {
        const { data: rows } = await svc.rpc(
          "health_playlist_missing_catalog_tracks",
          { playlist_key: w.playlist_key, run_date: runDate },
        );
        const tracks: TrackBase[] = ((rows ?? []) as Array<Record<string, unknown>>)
          .map((t) => ({
            isrc: normalizeIsrc(t.isrc),
            name: (t.name ?? null) as string | null,
            artist_names: (t.artist_names ?? null) as string[] | null,
            artist_ids: (t.artist_ids ?? null) as string[] | null,
            album_image_url: (t.album_image_url ?? null) as string | null,
          }))
          .filter((t) =>
            enabled ? !isExcludedNc(excl, w.playlist_key!, t.isrc) : true,
          );
        result.set(w.playlist_key, tracks);
      } catch (e) {
        logError("health_playlist_missing_catalog_tracks RPC failed", e);
      }
    }),
  );
  return result;
}

async function fetchSwingTracks(
  svc: Svc,
  warnings: WarningRow[],
  runDate: string,
): Promise<Map<string, SwingTracks>> {
  const result = new Map<string, SwingTracks>();

  await Promise.all(
    warnings.map(async (w) => {
      if (!w.playlist_key) return;
      try {
        const { data: rows } = await svc.rpc(
          "health_track_count_swing_tracks",
          { playlist_key: w.playlist_key, run_date: runDate },
        );
        const changeRows = (rows ?? []) as Array<Record<string, unknown>>;
        const mapRow = (r: Record<string, unknown>): TrackBase => ({
          isrc: normalizeIsrc(r.isrc),
          name: (r.name ?? null) as string | null,
          artist_names: (r.artist_names ?? null) as string[] | null,
          artist_ids: (r.artist_ids ?? null) as string[] | null,
          album_image_url: (r.album_image_url ?? null) as string | null,
        });
        result.set(w.playlist_key, {
          added: changeRows
            .filter((r) => String(r.change_type ?? "") === "added")
            .map(mapRow),
          removed: changeRows
            .filter((r) => String(r.change_type ?? "") === "removed")
            .map(mapRow),
        });
      } catch (e) {
        logError("health_track_count_swing_tracks RPC failed", e);
      }
    }),
  );
  return result;
}

async function fetchEnrichmentTracks(
  svc: Svc,
  warnings: WarningRow[],
  runDate: string,
  excl: ExclusionSets,
): Promise<Map<string, TrackBase[] | null>> {
  const result = new Map<string, TrackBase[] | null>();

  await Promise.all(
    warnings.map(async (w) => {
      if (!w.playlist_key) return;
      const details = w.details_json as MissingEnrichmentDetailsJson | null;
      const isrcList = details?.isrc_list ?? [];

      if (Array.isArray(isrcList) && isrcList.length > 0) {
        const filtered = (isrcList as unknown[])
          .map((x) => normalizeIsrc(x))
          .filter(Boolean)
          .filter((isrc) => !isExcludedEnr(excl, w.playlist_key!, isrc));

        if (filtered.length === 0) {
          result.set(w.playlist_key, []);
          return;
        }

        try {
          const { data: rows, error } = await svc
            .from("tracks")
            .select(
              "isrc,name,spotify_artist_names,spotify_artist_ids,spotify_album_image_url",
            )
            .in("isrc", filtered)
            .is("spotify_artist_ids", null);

          if (error) {
            result.set(w.playlist_key, null);
            return;
          }

          const tracks: TrackBase[] = ((rows ?? []) as Array<Record<string, unknown>>)
            .map((t) => ({
              isrc: normalizeIsrc(t.isrc),
              name: (t.name ?? null) as string | null,
              artist_names: (t.spotify_artist_names ?? null) as string[] | null,
              artist_ids: (t.spotify_artist_ids ?? null) as string[] | null,
              album_image_url: (t.spotify_album_image_url ?? null) as string | null,
            }))
            .filter((t) => !isExcludedEnr(excl, w.playlist_key!, t.isrc));

          result.set(w.playlist_key, tracks);
        } catch {
          result.set(w.playlist_key, null);
        }
      } else {
        try {
          const { data: rows, error } = await svc.rpc(
            "health_playlist_missing_enrichment_tracks",
            { playlist_key: w.playlist_key, run_date: runDate, limit_rows: 200 },
          );
          if (error) {
            result.set(w.playlist_key, null);
            return;
          }
          const tracks: TrackBase[] = ((rows ?? []) as Array<Record<string, unknown>>)
            .map((t) => ({
              isrc: normalizeIsrc(t.isrc),
              name: (t.name ?? null) as string | null,
              artist_names: (t.artist_names ?? null) as string[] | null,
              artist_ids: (t.artist_ids ?? null) as string[] | null,
              album_image_url: (t.album_image_url ?? null) as string | null,
            }))
            .filter((t) => !isExcludedEnr(excl, w.playlist_key!, t.isrc));
          result.set(w.playlist_key, tracks);
        } catch {
          result.set(w.playlist_key, null);
        }
      }
    }),
  );

  return result;
}

async function fetchDriftData(
  svc: Svc,
  warnings: WarningRow[],
  runDate: string,
): Promise<{ map: Map<string, DriftData>; loaded: boolean }> {
  const map = new Map<string, DriftData>();
  if (warnings.length === 0) return { map, loaded: false };

  try {
    const { data: driftRows, error } = await svc.rpc(
      "health_entity_distro_drift",
      { run_date: runDate },
    );
    if (error) return { map, loaded: false };

    for (const row of (driftRows ?? []) as Array<Record<string, unknown>>) {
      const key = normalizeKey(row.entity_playlist_key as string);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { extra: [], missing: [] });
      const entry = map.get(key)!;
      const track: DriftTrack = {
        isrc: normalizeIsrc(row.isrc),
        name: (row.name ?? null) as string | null,
        artist_names: (row.artist_names ?? null) as string[] | null,
        artist_ids: (row.artist_ids ?? null) as string[] | null,
        album_image_url: (row.album_image_url ?? null) as string | null,
        source_playlist_key: row.source_playlist_key
          ? String(row.source_playlist_key).trim()
          : null,
      };
      if (row.drift_type === "extra_in_distro") entry.extra.push(track);
      else if (row.drift_type === "missing_from_distro") entry.missing.push(track);
    }

    return { map, loaded: true };
  } catch {
    return { map, loaded: false };
  }
}

async function fetchOverlapTracks(
  svc: Svc,
  warnings: WarningRow[],
  runDate: string,
): Promise<OverlapTrack[] | null> {
  if (warnings.length === 0) return null;

  try {
    const { data: rows, error } = await svc.rpc(
      "health_distro_overlap_tracks",
      { run_date: runDate },
    );
    if (error) return null;

    return ((rows ?? []) as Array<Record<string, unknown>>).map((t) => ({
      isrc: normalizeIsrc(t.isrc),
      name: (t.name ?? null) as string | null,
      artist_names: (t.artist_names ?? null) as string[] | null,
      artist_ids: (t.artist_ids ?? null) as string[] | null,
      album_image_url: (t.album_image_url ?? null) as string | null,
      distro_playlist_keys: Array.isArray(t.distro_playlist_keys)
        ? (t.distro_playlist_keys as string[])
        : [],
    }));
  } catch {
    return null;
  }
}

async function fetchNegativeStreamTracks(
  svc: Svc,
  runDate: string,
): Promise<NegativeDailyStreamTrack[] | null> {
  try {
    const { data: rows, error } = await svc.rpc(
      "health_negative_daily_streams",
      { run_date: runDate },
    );
    if (error) return null;

    return ((rows ?? []) as Array<Record<string, unknown>>).map((t) => ({
      isrc: normalizeIsrc(t.isrc),
      name: (t.name ?? null) as string | null,
      artist_names: (t.artist_names ?? null) as string[] | null,
      artist_ids: (t.artist_ids ?? null) as string[] | null,
      album_image_url: (t.album_image_url ?? null) as string | null,
      daily_streams_delta: typeof t.daily_streams_delta === "number" ? t.daily_streams_delta : null,
      total_streams_cumulative: typeof t.total_streams_cumulative === "number" ? t.total_streams_cumulative : null,
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stream override loader — ISRCs with manual overrides for a given data date
// ---------------------------------------------------------------------------

async function loadOverriddenIsrcs(
  svc: Svc,
  dataDate: string,
): Promise<Set<string>> {
  const overridden = new Set<string>();
  try {
    const { data: rows } = await svc
      .from("track_daily_stream_overrides")
      .select("isrc")
      .eq("date", dataDate)
      .limit(5000);
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const isrc = normalizeIsrc(r.isrc);
      if (isrc) overridden.add(isrc);
    }
  } catch {
    // Table may not exist yet
  }
  return overridden;
}

// ---------------------------------------------------------------------------
// Message patching — builds the final user-visible message from live data
// ---------------------------------------------------------------------------

function patchMessage(
  w: WarningRow,
  ncMap: Map<string, TrackBase[]>,
  swingMap: Map<string, SwingTracks>,
  enrichMap: Map<string, TrackBase[] | null>,
  catalogMissingMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  prevNonzeroMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  staleMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  driftResult: { map: Map<string, DriftData>; loaded: boolean },
  overlapTracks: OverlapTrack[] | null,
  decreasedMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  negativeStreamTracks: NegativeDailyStreamTrack[] | null,
  playlistMeta: Map<string, PlaylistMeta>,
): string {
  if (w.code === "non_catalog_tracks_present" && w.playlist_key) {
    const tracks = ncMap.get(w.playlist_key);
    if (tracks)
      return `${tracks.length} track(s) in playlist have no catalog stream snapshot today`;
  }
  if (w.code === "tracks_missing_enrichment" && w.playlist_key) {
    const tracks = enrichMap.get(w.playlist_key);
    if (Array.isArray(tracks))
      return `${tracks.length} track(s) in playlist are missing Spotify enrichment data`;
  }
  if (w.code === "track_count_swing" && w.playlist_key) {
    const swing = swingMap.get(w.playlist_key);
    if (swing)
      return `Track count swing: ${swing.added.length} added, ${swing.removed.length} removed`;
  }
  if (w.code === "entity_distro_drift" && w.playlist_key && driftResult.loaded) {
    const pk = normalizeKey(w.playlist_key);
    const drift = driftResult.map.get(pk) ?? { extra: [], missing: [] };
    const plName = playlistMeta.get(pk)?.name ?? pk;
    return `Entity/Distro mismatch for ${plName}: ${drift.extra.length} extra in Distro, ${drift.missing.length} missing from Distro`;
  }
  if (w.code === "catalog_missing_stream_snapshots") {
    const key = String(w.playlist_key ?? "global");
    const tracks = catalogMissingMap.get(key);
    if (Array.isArray(tracks))
      return `${tracks.length} catalog track(s) are missing stream snapshots today`;
  }
  if (w.code === "catalog_streams_missing_prev_nonzero") {
    const key = String(w.playlist_key ?? "global");
    const tracks = prevNonzeroMap.get(key);
    if (Array.isArray(tracks))
      return `${tracks.length} catalog track(s) have zero streams today but had streams previously`;
  }
  if (w.code === "individual_tracks_stale") {
    const key = String(w.playlist_key ?? "global");
    const tracks = staleMap.get(key);
    if (Array.isArray(tracks)) {
      return `${tracks.length} track(s) with stale stream data`;
    }
  }
  if (w.code === "distro_overlap" && Array.isArray(overlapTracks)) {
    return `${overlapTracks.length} track(s) appear in multiple Distro playlists`;
  }
  if (w.code === "negative_daily_streams" && Array.isArray(negativeStreamTracks)) {
    return `${negativeStreamTracks.length} track(s) had negative daily streams`;
  }
  if (w.code === "total_streams_decreased") {
    const key = String(w.playlist_key ?? "global");
    const tracks = decreasedMap.get(key);
    const dj = w.details_json as TotalStreamsDecreasedDetailsJson | null;
    const delta = dj?.delta;
    const prevTotal = dj?.prev_total_streams_cumulative;
    const todayTotal = dj?.today_total_streams_cumulative;
    const trackCount = Array.isArray(tracks)
      ? tracks.length
      : (dj?.decreased_tracks_total ?? 0);
    const removedCount = dj?.removed_tracks_total ?? 0;
    const deltaStr =
      typeof delta === "number" ? delta.toLocaleString() : "?";
    const parts = [
      `Total streams decreased ${deltaStr} (${typeof prevTotal === "number" ? prevTotal.toLocaleString() : "?"} → ${typeof todayTotal === "number" ? todayTotal.toLocaleString() : "?"})`,
    ];
    if (removedCount > 0) {
      parts.push(`${removedCount} track(s) removed`);
    }
    if (trackCount > 0) {
      parts.push(`${trackCount} track(s) decreased`);
    }
    if (removedCount === 0 && trackCount === 0) {
      parts.push("0 track(s) decreased");
    }
    return parts.join(" — ");
  }
  return w.message;
}

// ---------------------------------------------------------------------------
// Build WarningExpandedData for a single warning
// ---------------------------------------------------------------------------

function buildExpandedData(
  w: WarningRow,
  ncMap: Map<string, TrackBase[]>,
  swingMap: Map<string, SwingTracks>,
  enrichMap: Map<string, TrackBase[] | null>,
  catalogMissingMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  prevNonzeroMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  staleMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  excludedZeroedMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  decreasedMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  removedMap: Map<string, Array<TrackBase & Record<string, unknown>> | null>,
  driftResult: { map: Map<string, DriftData>; loaded: boolean },
  overlapTracks: OverlapTrack[] | null,
  negativeStreamTracks: NegativeDailyStreamTrack[] | null,
): WarningExpandedData {
  const key = String(w.playlist_key ?? "global");
  const noteFromDetails = (w.details_json as Record<string, unknown> | null)?.note as
    | string
    | undefined;

  switch (w.code) {
    case "non_catalog_tracks_present": {
      const tracks = w.playlist_key ? ncMap.get(w.playlist_key) : undefined;
      if (tracks && tracks.length > 0)
        return { type: "non_catalog_tracks_present", tracks };
      return null;
    }
    case "track_count_swing": {
      const swing = w.playlist_key ? swingMap.get(w.playlist_key) : undefined;
      if (swing && (swing.added.length > 0 || swing.removed.length > 0))
        return { type: "track_count_swing", swing };
      return null;
    }
    case "tracks_missing_enrichment": {
      const tracks = w.playlist_key ? enrichMap.get(w.playlist_key) : undefined;
      if (tracks === undefined) return null;
      if (Array.isArray(tracks) && tracks.length === 0) return null;
      return {
        type: "tracks_missing_enrichment",
        tracks: tracks,
        note:
          noteFromDetails ??
          "Run the Spotify enrichment workflow to update artist names and metadata.",
      };
    }
    case "catalog_missing_stream_snapshots": {
      const raw = catalogMissingMap.get(key);
      if (raw === undefined) return null;
      if (Array.isArray(raw) && raw.length === 0) return null;
      return {
        type: "catalog_missing_stream_snapshots",
        tracks: raw as TrackBase[] | null,
        note:
          noteFromDetails ??
          "These tracks appeared in a catalog export but had missing/invalid stream totals and were not written to track_daily_streams.",
      };
    }
    case "catalog_streams_missing_prev_nonzero": {
      const raw = prevNonzeroMap.get(key);
      if (raw === undefined) return null;
      if (Array.isArray(raw) && raw.length === 0) return null;
      return {
        type: "catalog_streams_missing_prev_nonzero",
        tracks: raw as PrevNonzeroTrack[] | null,
        note:
          noteFromDetails ??
          "SpotOnTrack export had missing/blank stream totals for tracks that had non-zero cumulative streams yesterday.",
      };
    }
    case "individual_tracks_stale": {
      const raw = staleMap.get(key);
      if (raw === undefined) return null;
      if (Array.isArray(raw) && raw.length === 0) return null;
      return {
        type: "individual_tracks_stale",
        tracks: raw as StaleTrack[] | null,
        note:
          noteFromDetails ??
          "Tracks with stale stream data were detected during ingestion. Check the Health page after the next run for details.",
      };
    }
    case "excluded_track_streams_zeroed": {
      const raw = excludedZeroedMap.get(key);
      if (raw === undefined) return null;
      if (Array.isArray(raw) && raw.length === 0) return null;
      return {
        type: "excluded_track_streams_zeroed",
        tracks: raw as ExcludedZeroedTrack[] | null,
        note:
          noteFromDetails ??
          "Excluded (taken-down) tracks had their total streams drop to zero. This likely indicates a data-source glitch.",
      };
    }
    case "total_streams_decreased": {
      const raw = decreasedMap.get(key);
      const dj = w.details_json as TotalStreamsDecreasedDetailsJson | null;
      
      // Decreased tracks: use database results, fall back to details_json
      let tracks = raw;
      if (!Array.isArray(tracks) || tracks.length === 0) {
        const fallbackTracks = (dj?.decreased_tracks ?? []).map((t) => ({
          isrc: t.isrc,
          name: null as string | null,
          artist_names: null as string[] | null,
          prev_streams: t.prev_streams ?? null,
          today_streams: t.today_streams ?? null,
          delta: t.delta ?? null,
        }));
        tracks = fallbackTracks.length > 0 ? fallbackTracks : null;
      }

      // Removed tracks: use database results, fall back to details_json
      let removedRaw = removedMap.get(key);
      if (!Array.isArray(removedRaw) || removedRaw.length === 0) {
        const fallbackRemoved = (dj?.removed_tracks ?? []).map((t) => ({
          isrc: t.isrc,
          name: null as string | null,
          artist_names: null as string[] | null,
          prev_streams: t.prev_streams ?? null,
        }));
        removedRaw = fallbackRemoved.length > 0 ? fallbackRemoved : null;
      }

      const removedStreamsTotal = dj?.removed_streams_total ?? 0;

      const hasData =
        (Array.isArray(tracks) && tracks.length > 0) ||
        (Array.isArray(removedRaw) && removedRaw.length > 0);
      if (!hasData) return null;

      return {
        type: "total_streams_decreased",
        tracks: (tracks as DecreasedTrack[] | null) ?? null,
        removedTracks: (removedRaw as RemovedTrack[] | null) ?? null,
        removedStreamsTotal: removedStreamsTotal,
        note:
          noteFromDetails ??
          "Total streams decreased day-over-day. This may indicate tracks were removed or Spotify adjusted stream counts.",
      };
    }
    case "entity_distro_drift": {
      if (!w.playlist_key) return null;
      const drift = driftResult.map.get(normalizeKey(w.playlist_key));
      if (drift && (drift.extra.length > 0 || drift.missing.length > 0))
        return { type: "entity_distro_drift", drift };
      return null;
    }
    case "distro_overlap": {
      if (overlapTracks === undefined) return null;
      if (Array.isArray(overlapTracks) && overlapTracks.length === 0) return null;
      return {
        type: "distro_overlap",
        tracks: overlapTracks,
        note: "Track details not available. Run the migration for health_distro_overlap_tracks to enable detailed display.",
      };
    }
    case "negative_daily_streams": {
      if (negativeStreamTracks === undefined) return null;
      if (Array.isArray(negativeStreamTracks) && negativeStreamTracks.length === 0) return null;
      return {
        type: "negative_daily_streams",
        tracks: negativeStreamTracks,
        note: "Tracks with negative daily stream deltas (corrections, deduplication, or anomalies).",
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Severity sort helper
// ---------------------------------------------------------------------------

function severityRank(severity: string): number {
  switch ((severity ?? "").trim()) {
    case "critical":
      return 0;
    case "warn":
      return 1;
    case "info":
      return 2;
    default:
      return 99;
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator (#1: all data-fetching extracted from page.tsx)
// ---------------------------------------------------------------------------

export type PaginatedWarnings = {
  warnings: DisplayedWarning[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function fetchDisplayedWarnings(
  runDate: string,
  playlistMeta: Record<string, PlaylistMeta>,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PaginatedWarnings> {
  const svc = supabaseService();
  const { warnings } = await getActiveWarningSummary(runDate);
  const excl = await loadExclusions(svc);
  const metaMap = new Map(Object.entries(playlistMeta));

  // Group warnings by code
  const ncW = warnings.filter(
    (w) => w.code === "non_catalog_tracks_present" && w.playlist_key && runDate,
  );
  const swingW = warnings.filter(
    (w) => w.code === "track_count_swing" && w.playlist_key && runDate,
  );
  const enrichW = warnings.filter(
    (w) => w.code === "tracks_missing_enrichment" && w.playlist_key && runDate,
  );
  const catalogMissingW = warnings.filter(
    (w) => w.code === "catalog_missing_stream_snapshots" && runDate,
  );
  const prevNonzeroW = warnings.filter(
    (w) => w.code === "catalog_streams_missing_prev_nonzero" && runDate,
  );
  const staleW = warnings.filter(
    (w) => w.code === "individual_tracks_stale" && runDate,
  );
  const excludedZeroedW = warnings.filter(
    (w) => w.code === "excluded_track_streams_zeroed" && runDate,
  );
  const decreasedW = warnings.filter(
    (w) => w.code === "total_streams_decreased" && runDate,
  );
  const driftW = warnings.filter(
    (w) => w.code === "entity_distro_drift" && w.playlist_key && runDate,
  );
  const overlapW = warnings.filter((w) => w.code === "distro_overlap");

  // #4: Run ALL fetchers in parallel
  // track_daily_streams.date stores the run date, so overrides use the same convention.
  const [
    ncMap,
    swingMap,
    enrichMap,
    catalogMissingMap,
    prevNonzeroMap,
    staleMapRaw,
    excludedZeroedMap,
    decreasedMap,
    removedMap,
    driftResult,
    overlapTracks,
    negativeStreamTracks,
    overriddenIsrcs,
  ] = await Promise.all([
    fetchNonCatalogTracks(svc, ncW, runDate, excl),
    fetchSwingTracks(svc, swingW, runDate),
    fetchEnrichmentTracks(svc, enrichW, runDate, excl),
    fetchDetailsTracks(svc, catalogMissingW, extractCatalogMissing),
    fetchDetailsTracks(svc, prevNonzeroW, extractPrevNonzero),
    fetchDetailsTracks(svc, staleW, extractStale),
    fetchDetailsTracks(svc, excludedZeroedW, extractExcludedZeroed),
    fetchDetailsTracks(svc, decreasedW, extractDecreased),
    fetchDetailsTracks(svc, decreasedW, extractRemoved),
    fetchDriftData(svc, driftW, runDate),
    fetchOverlapTracks(svc, overlapW, runDate),
    fetchNegativeStreamTracks(svc, runDate),
    loadOverriddenIsrcs(svc, runDate),
  ]);

  // Filter overridden ISRCs out of stale track results
  const staleMap = new Map<string, Array<TrackBase & Record<string, unknown>> | null>();
  for (const [key, tracks] of staleMapRaw) {
    if (!tracks || overriddenIsrcs.size === 0) {
      staleMap.set(key, tracks);
    } else {
      const filtered = tracks.filter(
        (t) => !overriddenIsrcs.has(normalizeIsrc(t.isrc)),
      );
      staleMap.set(key, filtered.length > 0 ? filtered : null);
    }
  }

  // Sort & build DisplayedWarning[]
  const sorted = [...warnings].sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity);
    if (r !== 0) return r;
    const ap = normalizeKey(a.playlist_key);
    const bp = normalizeKey(b.playlist_key);
    if (ap !== bp) return ap.localeCompare(bp);
    const ac = normalizeKey(a.code);
    const bc = normalizeKey(b.code);
    if (ac !== bc) return ac.localeCompare(bc);
    return (a.message ?? "").localeCompare(b.message ?? "");
  });

  const all: DisplayedWarning[] = sorted.map((w) => ({
    severity: w.severity,
    code: w.code,
    playlist_key: w.playlist_key,
    run_date: w.run_date,
    message: patchMessage(
      w,
      ncMap,
      swingMap,
      enrichMap,
      catalogMissingMap,
      prevNonzeroMap,
      staleMap,
      driftResult,
      overlapTracks,
      decreasedMap,
      negativeStreamTracks,
      metaMap,
    ),
    playlistMeta: w.playlist_key
      ? metaMap.get(w.playlist_key) ?? null
      : null,
    expandedData: buildExpandedData(
      w,
      ncMap,
      swingMap,
      enrichMap,
      catalogMissingMap,
      prevNonzeroMap,
      staleMap,
      excludedZeroedMap,
      decreasedMap,
      removedMap,
      driftResult,
      overlapTracks,
      negativeStreamTracks,
    ),
  }));

  const totalCount = all.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageWarnings = all.slice(start, start + pageSize);

  return { warnings: pageWarnings, totalCount, page: safePage, pageSize, totalPages };
}

// ---------------------------------------------------------------------------
// Missing catalog tracks (for the separate section below the warnings table)
// ---------------------------------------------------------------------------

export async function fetchMissingCatalogTracks(
  runDate: string,
): Promise<MissingCatalogTrack[]> {
  const svc = supabaseService();
  const excl = await loadExclusions(svc);
  const enabled = ncExclusionsEnabled(excl);

  const { data: rows, error } = await svc.rpc("health_missing_catalog_tracks", {
    run_date: runDate,
  });

  if (error) {
    logError("health_missing_catalog_tracks RPC failed", error);
    return [];
  }

  const all: MissingCatalogTrack[] = ((rows ?? []) as Array<Record<string, unknown>>).map(
    (t) => ({
      isrc: normalizeIsrc(t.isrc),
      name: (t.name ?? null) as string | null,
      artist_names: (t.artist_names ?? null) as string[] | null,
      artist_ids: (t.artist_ids ?? null) as string[] | null,
      album_image_url: (t.album_image_url ?? null) as string | null,
      playlists: Array.isArray(t.playlist_keys)
        ? (t.playlist_keys as string[])
        : [],
    }),
  );

  return enabled
    ? all.filter((t) => !t.playlists.some((pk) => isExcludedNc(excl, pk, t.isrc)))
    : all;
}
