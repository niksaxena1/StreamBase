import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import CatalogLoading from "./loading";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cachedQuery } from "@/lib/supabase/cache";
import { getArtistsCached } from "@/lib/spotify";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { CatalogPageClient } from "./CatalogPageClient";
import { computeDailyRollingAvg7 } from "@/components/charts/chartUtils";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { Alert } from "@/components/ui/Alert";
import { CACHE_TTL_1H, API_LOOKUP_DROPDOWN_MAX, API_LOOKUP_THUMBNAILS_MAX, API_LOOKUP_TRACK_MAX } from "@/lib/constants";
import { logError, logWarn } from "@/lib/logger";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { lastArtistIdStorageKey } from "@/lib/datasetSelectionStorage";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { timedServerStep } from "@/lib/serverTiming";
import { resolveCatalogTrackSelection } from "@/lib/catalogSelection";
import { CatalogArtistUnavailable, CatalogTrackUnavailable } from "./CatalogUnavailable";
import { renderCompetitorCatalogContent } from "./competitorCatalogContent";
import {
  fetchAllTrackSeries,
  fetchArtistOverrideAnnotations,
  fetchCatalogArtistSeries,
  fetchSelectedTrackPlaylistMemberships,
  fetchTopTrackDistroPlaylists,
} from "./catalogPageQueries";
import {
  MA7_LOOKBACK_DAYS,
  addDays,
  artistNameFor,
  catalogSelectionHref,
  clampRangeDays,
  sumLastNDays,
  type CatalogArtistSeriesRow,
  type CatalogSearchParams,
  type CatalogTopTrackRow,
  type ManualOverrideAnnotation,
  type PlaylistDailyStatsRow,
  type TrackOverrideRow,
  type TrackRow,
} from "./catalogPageUtils";

const CATALOG_ARTIST_DROPDOWN_MAX_TRACKS = API_LOOKUP_DROPDOWN_MAX;
const CATALOG_ARTIST_THUMBNAILS_MAX = API_LOOKUP_THUMBNAILS_MAX;

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalog",
};

type TrackDailyRow = {
  date: string;
  isrc: string;
  streams_cumulative: number | null;
};

async function fetchRecentTracksMetaForArtists(sb: SupabaseClient, maxRows = 2000): Promise<TrackRow[]> {
  // Intentionally bounded: we only need a "recent artists" dropdown list.
  // For full discovery, the global search (`/api/search`) is the scalable path.
  const { data, error } = await sb
    .from("tracks")
    .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url")
    .not("spotify_artist_ids", "is", null)
    .order("last_seen", { ascending: false })
    .limit(maxRows);

  if (error) {
    logError("Error fetching recent tracks metadata", error);
    return [];
  }

  return (data ?? []) as TrackRow[];
}

export default function CatalogPage(props: {
  searchParams?: Promise<CatalogSearchParams>;
}) {
  // Stream: the shell (and the route skeleton) render immediately while the
  // data-heavy content resolves — including on same-route param navigations
  // (artist/track selection) where loading.tsx alone doesn't apply.
  return (
    <Suspense fallback={<CatalogLoading />}>
      <CatalogPageTimed {...props} />
    </Suspense>
  );
}

async function CatalogPageTimed(props: {
  searchParams?: Promise<CatalogSearchParams>;
}) {
  return timedServerStep("page.catalog", () => CatalogPageContent(props));
}

async function CatalogPageContent({
  searchParams,
}: {
  searchParams?: Promise<CatalogSearchParams>;
}) {
  try {
    const sp = (await searchParams) ?? {};
    
    // Backwards-compat: old query-driven list view
    if ((sp.view ?? "").trim().toLowerCase() === "list") {
      redirect("/catalog/config");
    }

    let rangeDays = clampRangeDays(sp.range);
    if (sp.start && sp.end) {
      const start = new Date(`${sp.start}T00:00:00Z`);
      const end = new Date(`${sp.end}T00:00:00Z`);
      const calculatedDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      rangeDays = Math.max(1, Math.min(365, calculatedDays));
    }
    const { sb, svc, user, isAdmin, settings: datasetSettings } = await getRequestAppContext();
    if (!user) redirect("/login");

    if (!isAdmin) redirect("/");

    // IMPORTANT: Core analytics tables are admin-only via RLS. If we cache queries using
    // a request-scoped Supabase client, revalidation can run without cookies and fail,
    // leaving stale cached data. Use the service-role client for all data reads here;
    // access is still gated above.
    const datasetMode = normalizeDatasetMode(datasetSettings?.dataset_mode);

    if (datasetMode === "competitor") {
      return await renderCompetitorCatalogContent({ sp, rangeDays, svc, datasetSettings });
    }

    // Settings come from the request context (already fetched once per request).
    const wantsHide = Boolean(datasetSettings?.hide_stale_override_annotations);
    const excludeCatalog = Boolean(datasetSettings?.hide_stale_annotations_exclude_catalog);
    const hideStaleAnnotations = wantsHide && !excludeCatalog;

    // Cache-buster: include count + max(id) in cache keys so both additions AND
    // removals of overrides invalidate stale catalog aggregate caches.
    let overrideBuster = "0";
    try {
      // Single fast index-only aggregate (max id + count) computed in Postgres.
      const { data: version } = await svc.rpc("spotibase_override_version");
      if (typeof version === "string" && version) overrideBuster = version;
    } catch {
      // ignore (function may not exist yet)
    }

    const artistId = (sp.artist_id ?? "").trim();
    const requestedIsrc = (sp.isrc ?? "").trim();

    // If a track is specified without an artist, prefer the track's primary (first) artist.
    // This makes "click a track → open Catalog" land on the correct artist automatically.
    if (!artistId && requestedIsrc) {
      const { data: trackRow, error: trackError } = await cachedQuery(
        async () =>
          await svc
            .from("tracks")
            .select("spotify_artist_ids")
            .eq("isrc", requestedIsrc)
            .maybeSingle(),
        `catalog-isrc-primary-artist-${requestedIsrc}`,
        CACHE_TTL_1H,
      );

      if (trackError) {
        logError("Error resolving requested catalog track", trackError);
        return (
          <Alert variant="error" title="Error resolving track">
            {trackError.message}
          </Alert>
        );
      }

      const typed = (trackRow ?? null) as { spotify_artist_ids: string[] | null } | null;
      const primaryArtistId = Array.isArray(typed?.spotify_artist_ids)
        ? String(typed?.spotify_artist_ids?.[0] ?? "").trim()
        : "";

      if (primaryArtistId) {
        redirect(catalogSelectionHref(sp, primaryArtistId, requestedIsrc));
      }

      return (
        <CatalogTrackUnavailable
          datasetMode="own"
          isrc={requestedIsrc}
          reason={typed ? "missing_artist_metadata" : "not_found"}
        />
      );
    }

    if (!artistId) {
      // Scalable default: pick the most recently seen track's first artist (no "scan 5k tracks").
      const { data: recent } = await cachedQuery(
        async () =>
          await svc
            .from("tracks")
            .select("spotify_artist_ids")
            .not("spotify_artist_ids", "is", null)
            .order("last_seen", { ascending: false })
            .limit(1)
            .maybeSingle(),
        "catalog-default-artist-v1",
        CACHE_TTL_1H,
      );

      const recentTyped = recent as { spotify_artist_ids?: string[] | null } | null;
      const defaultArtistId = Array.isArray(recentTyped?.spotify_artist_ids)
        ? String(recentTyped.spotify_artist_ids?.[0] ?? "").trim()
        : "";

      return (
        <RememberParamRedirect
          param="artist_id"
          storageKey={lastArtistIdStorageKey("own")}
          legacyStorageKey="sb:last_artist_id"
          defaultValue={defaultArtistId || null}
          loadingTitle="Opening your last artist…"
          loadingSubtitle="If this is your first time, we'll pick the first artist we find."
        />
      );
    }

    // We don't have an artists table; the distinct-artist dropdown is computed in
    // Postgres (catalog_artist_options) instead of paging thousands of track rows
    // to the web server and deriving it in JS.
    // Note: This is intentionally capped for performance. For long-tail discovery, use the global search bar.
    const { data: artistOptionRows } = await cachedQuery(
      async () =>
        await svc.rpc("catalog_artist_options", {
          max_tracks: CATALOG_ARTIST_DROPDOWN_MAX_TRACKS,
        }),
      `catalog-artist-options-v1-${CATALOG_ARTIST_DROPDOWN_MAX_TRACKS}`,
      CACHE_TTL_1H,
    );
    let artists = ((artistOptionRows ?? []) as Array<{ id: string; name: string }>).filter(
      (a) => a.id && a.name,
    );
    if (artistId && !artists.some((artist) => artist.id === artistId)) {
      // The dropdown is intentionally built from a capped set of recent tracks, so a
      // valid long-tail artist found by global search may not be present in it. Verify
      // the requested artist against the source table before treating it as invalid.
      const { data: selectedArtistTrack, error: selectedArtistError } = await cachedQuery(
        async () =>
          await svc
            .from("tracks")
            .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url,release_date")
            .contains("spotify_artist_ids", [artistId])
            .order("last_seen", { ascending: false })
            .limit(1)
            .maybeSingle(),
        `catalog-selected-artist-option-v1-${artistId}`,
        CACHE_TTL_1H,
      );

      if (selectedArtistError) {
        logError("Error resolving requested catalog artist", selectedArtistError);
        return (
          <Alert variant="error" title="Error resolving artist">
            {selectedArtistError.message}
          </Alert>
        );
      }

      const selectedArtistTrackRow = (selectedArtistTrack ?? null) as TrackRow | null;
      if (selectedArtistTrackRow) {
        artists = [
          ...artists,
          {
            id: artistId,
            name: artistNameFor([selectedArtistTrackRow], artistId) ?? artistId,
          },
        ].sort((a, b) => a.name.localeCompare(b.name));
      } else if (!requestedIsrc) {
        return (
          <CatalogArtistUnavailable
            datasetMode="own"
            artistId={artistId}
            fallbackHref={artists[0]?.id ? `/catalog?artist_id=${encodeURIComponent(artists[0].id)}` : null}
          />
        );
      }
    }

  // Track list for this artist (cached for 1 hour)
  const { data: tracks, error: tracksError } = await cachedQuery(
    async () =>
      await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url,release_date")
        .contains("spotify_artist_ids", [artistId])
        .order("last_seen", { ascending: false })
        .limit(800),
    // Bump cache version when selected columns change (release_date added).
    `artist-tracks-v3-${artistId}`,
    CACHE_TTL_1H,
  );

  if (tracksError) {
    logError("Error fetching artist tracks", tracksError);
    // Return error state instead of crashing
    return (
      <div className="space-y-4">
        <Alert variant="error" title="Error loading artist data">
          {tracksError.message}
        </Alert>
      </div>
    );
  }

  let artistTracks = (tracks ?? []) as TrackRow[];

  if (requestedIsrc && !artistTracks.some((track) => track.isrc === requestedIsrc)) {
    const { data: requestedTrack, error: requestedTrackError } = await cachedQuery(
      async () =>
        await svc
          .from("tracks")
          .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url,release_date")
          .eq("isrc", requestedIsrc)
          .maybeSingle(),
      `catalog-requested-track-v1-${requestedIsrc}`,
      CACHE_TTL_1H,
    );

    if (requestedTrackError) {
      logError("Error resolving requested catalog track", requestedTrackError);
      return (
        <Alert variant="error" title="Error resolving track">
          {requestedTrackError.message}
        </Alert>
      );
    }

    const selection = resolveCatalogTrackSelection({
      requestedArtistId: artistId,
      requestedIsrc,
      artistTracks,
      resolvedTrack: (requestedTrack ?? null) as TrackRow | null,
      resolvedTrackIsActiveInScope: true,
    });

    if (selection.kind === "redirect") {
      redirect(catalogSelectionHref(sp, selection.artistId, selection.isrc));
    }
    if (selection.kind === "unavailable") {
      return (
        <CatalogTrackUnavailable
          datasetMode="own"
          isrc={requestedIsrc}
          reason={selection.reason}
        />
      );
    }
    if (selection.shouldInject) {
      artistTracks = [selection.track, ...artistTracks];
    }
  }

  const isrcs = artistTracks.map((t) => t.isrc);

  const artistName =
    artists.find((a) => a.id === artistId)?.name ??
    artistNameFor(artistTracks, artistId) ??
    artistId;

  // Global time-rollback: if active, cap all queries at this date.
  const rollbackDate = await getRollbackDate();
  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;

  // Canonical latest RUN date (DB snapshot date) - cached, capped by rollback
  const { data: latestRun } = await cachedQuery(
    async () => {
      let q = svc
        .from("playlist_daily_stats")
        .select("date")
        .eq("playlist_key", "all_catalog");
      if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
      return await q
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
    },
    `latest-date-all-catalog-rb${rollbackDate ?? "live"}`,
    CACHE_TTL_1H,
  );

  const latestRunDate = (latestRun as PlaylistDailyStatsRow | null)?.date ?? null;
  const startRunDate = latestRunDate ? addDays(latestRunDate, -rangeDays) : null;
  const maPaddedStartRunDate =
    latestRunDate && startRunDate ? addDays(startRunDate, -MA7_LOOKBACK_DAYS) : null;

  const isrc = requestedIsrc || null;

  // Auto-select first track alphabetically if no track is selected and tracks are available
  if (!isrc && artistTracks.length > 0) {
    const sortedTracks = [...artistTracks]
      .map((t) => ({ isrc: t.isrc, name: t.name ?? t.isrc }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (sortedTracks.length > 0) {
      const firstTrackIsrc = sortedTracks[0].isrc;
      // Redirect to include the first track in the URL
      const params = new URLSearchParams();
      params.set("artist_id", artistId);
      params.set("isrc", firstTrackIsrc);
      if (sp.range) params.set("range", String(rangeDays));
      redirect(`/catalog?${params.toString()}`);
    }
  }

  // Artist series + top tracks are computed in Postgres (scales to large tables).
  const [{ data: seriesRows }, { data: topTotalRows }, { data: topDailyRows }] = await Promise.all([
    latestRunDate && startRunDate && maPaddedStartRunDate
      ? cachedQuery(
          async () =>
            await fetchCatalogArtistSeries(svc, {
              artistId,
              startDate: maPaddedStartRunDate,
              endDate: latestRunDate,
            }),
          `catalog-artist-series-fast-v1-${artistId}-${maPaddedStartRunDate}-${latestRunDate}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        )
      : Promise.resolve({ data: [] as CatalogArtistSeriesRow[], error: null }),
    latestRunDate
      ? cachedQuery(
          async () =>
            await svc.rpc("catalog_artist_top_tracks_total", {
              artist_id: artistId,
              run_date: latestRunDate,
              limit_rows: Math.max(isrcs.length, 1000),
            }),
          `catalog-artist-top-total-v3-${artistId}-${latestRunDate}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        )
      : Promise.resolve({ data: [] as CatalogTopTrackRow[], error: null }),
    latestRunDate
      ? cachedQuery(
          async () =>
            await svc.rpc("catalog_artist_top_tracks_daily", {
              artist_id: artistId,
              run_date: latestRunDate,
              limit_rows: Math.max(isrcs.length, 1000),
            }),
          `catalog-artist-top-daily-v3-${artistId}-${latestRunDate}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        )
      : Promise.resolve({ data: [] as CatalogTopTrackRow[], error: null }),
  ]);

  const cumSeriesAscRunFull = ((seriesRows ?? []) as CatalogArtistSeriesRow[])
    .map((r) => ({ date: r.date, value: Number(r.streams_cumulative ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const cumSeriesAscRun = startRunDate
    ? cumSeriesAscRunFull.filter((p) => p.date >= startRunDate)
    : cumSeriesAscRunFull;

  // Keep dates as RUN dates in server payload; UI shifts to "data date" for display.
  const cumSeriesAsc = cumSeriesAscRun;

  const latestCum = cumSeriesAscRun.length ? cumSeriesAscRun[cumSeriesAscRun.length - 1].value : 0;

  const dailyArtistAscRunFull = cumSeriesAscRunFull.map((p, idx) => {
    if (idx === 0) return { date: p.date, daily: null };
    const prev = cumSeriesAscRunFull[idx - 1].value;
    return { date: p.date, daily: p.value - prev };
  });
  const dailyArtistDescFull = [...dailyArtistAscRunFull].reverse();
  const dailyArtistDesc = startRunDate
    ? computeDailyRollingAvg7(dailyArtistDescFull).filter((p) => p.date >= startRunDate)
    : computeDailyRollingAvg7(dailyArtistDescFull);

  const artist24h = dailyArtistDesc[0]?.daily ?? 0;
  const artist7d = sumLastNDays(dailyArtistDesc, 7);
  const artist28d = sumLastNDays(dailyArtistDesc, 28);
  const artist30d = sumLastNDays(dailyArtistDesc, 30);

  const trackMetaByIsrc = new Map<string, TrackRow>();
  for (const t of artistTracks) trackMetaByIsrc.set(t.isrc, t);

  // Ensure top-track rows have artist metadata (even if the artist track list is capped).
  const topIsrcs = new Set<string>();
  for (const r of (topTotalRows ?? []) as CatalogTopTrackRow[]) topIsrcs.add(r.isrc);
  for (const r of (topDailyRows ?? []) as CatalogTopTrackRow[]) topIsrcs.add(r.isrc);
  const missingTopIsrcs = Array.from(topIsrcs).filter((x) => x && !trackMetaByIsrc.has(x));
  if (missingTopIsrcs.length) {
    const { data: metaRows, error } = await svc
      .from("tracks")
      .select("isrc,spotify_artist_ids,spotify_artist_names,release_date")
      .in("isrc", missingTopIsrcs);
    if (error) {
      logWarn("Error fetching top-track artist metadata", error);
    } else {
      for (const r of (metaRows ?? []) as Array<{
        isrc: string;
        spotify_artist_ids: string[] | null;
        spotify_artist_names: string[] | null;
        release_date: string | null;
      }>) {
        if (!r?.isrc) continue;
        trackMetaByIsrc.set(r.isrc, {
          isrc: r.isrc,
          name: null,
          spotify_artist_ids: r.spotify_artist_ids ?? null,
          spotify_artist_names: r.spotify_artist_names ?? null,
          spotify_album_image_url: null,
          release_date: r.release_date ?? null,
        });
      }
    }
  }

  // Batch-fetch the distro playlist (playlist_type = 'Distro') for every top-track ISRC.
  const distroByIsrc = await fetchTopTrackDistroPlaylists(svc, { artistId, latestRunDate, topIsrcs });

  const topByCumulative = ((topTotalRows ?? []) as CatalogTopTrackRow[]).map((r) => {
    const meta = trackMetaByIsrc.get(r.isrc) ?? null;
    const distro = distroByIsrc.get(r.isrc) ?? null;
    return {
      isrc: r.isrc,
      total: r.total ?? null,
      daily: null,
      name: r.name ?? null,
      albumImageUrl: r.album_image_url ?? null,
      artistNames: meta?.spotify_artist_names ?? null,
      artistIds: meta?.spotify_artist_ids ?? null,
      releaseDate: (meta?.release_date ?? "").trim() || null,
      distroPlaylistName: distro?.name ?? null,
      distroPlaylistImageUrl: distro?.imageUrl ?? null,
    };
  });

  const topByDaily = ((topDailyRows ?? []) as CatalogTopTrackRow[]).map((r) => {
    const meta = trackMetaByIsrc.get(r.isrc) ?? null;
    const distro = distroByIsrc.get(r.isrc) ?? null;
    return {
      isrc: r.isrc,
      daily: r.daily ?? null,
      total: r.total ?? null,
      name: r.name ?? null,
      albumImageUrl: r.album_image_url ?? null,
      artistNames: meta?.spotify_artist_names ?? null,
      artistIds: meta?.spotify_artist_ids ?? null,
      releaseDate: (meta?.release_date ?? "").trim() || null,
      distroPlaylistName: distro?.name ?? null,
      distroPlaylistImageUrl: distro?.imageUrl ?? null,
    };
  });

  // Selected track panels (optional). Wrap in cachedQuery: series data only changes
  // when a new ingestion run completes (daily), but can include many paginated rows.
  const trackSeries = isrc && latestRunDate && startRunDate && maPaddedStartRunDate
    ? (
        await cachedQuery(
          async () => ({
            data: await fetchAllTrackSeries(svc, {
              isrc,
              startDate: maPaddedStartRunDate,
              endDate: latestRunDate,
              maxRows: API_LOOKUP_TRACK_MAX,
            }),
            error: null,
          }),
          `catalog-track-series-${isrc}-${maPaddedStartRunDate}-${latestRunDate}-ov${overrideBuster}`,
          CACHE_TTL_1H,
        )
      ).data ?? []
    : ([] as Array<{ date: string; streams_cumulative: number | null }>);

  const trackOverrideAnnotations =
    isrc && latestRunDate && startRunDate
      ? (
          await cachedQuery(
            async () => {
              let q = svc
                .from("track_daily_stream_overrides")
                .select("date,note")
                .eq("isrc", isrc)
                .gte("date", startRunDate)
                .lte("date", latestRunDate);
              if (hideStaleAnnotations) q = q.not("note", "like", "stale-fix:%");
              return await q.order("date", { ascending: false });
            },
            `track-overrides-${isrc}-${startRunDate}-${latestRunDate}-ov${overrideBuster}-stale${hideStaleAnnotations ? "1" : "0"}`,
            CACHE_TTL_1H,
          )
        ).data
      : [];

  const trackOverrideAnnotationsDataDate = ((trackOverrideAnnotations ?? []) as TrackOverrideRow[])
    .filter((r) => !!r?.date)
    .map((r) => ({
      date: dataDateFromRunDate(r.date),
      note: (r.note ?? "").trim() || `Manual override (ISRC: ${isrc})`,
    }));

  const trackSeriesInRange = startRunDate
    ? (trackSeries ?? []).filter((r) => r.date >= startRunDate)
    : (trackSeries ?? []);

  const trackCumDesc = trackSeriesInRange.map((r) => ({
    date: r.date,
    value: Number(r.streams_cumulative ?? 0),
  }));
  // Compute daily deltas based on RUN ordering but display DATA dates (include pad before range for MA7).
  const trackCumDescRun = (trackSeries ?? []).map((r) => ({
    date: r.date,
    value: Number(r.streams_cumulative ?? 0),
  }));
  const trackCumAscRun = [...trackCumDescRun].reverse();
  const trackDailyAsc = trackCumAscRun.map((p, idx) => {
    if (idx === 0) return { date: p.date, daily: null };
    const prev = trackCumAscRun[idx - 1].value;
    return { date: p.date, daily: p.value - prev };
  });
  const trackDailyDescFull = [...trackDailyAsc].reverse().map((p) => ({ ...p }));
  const trackDailyWithMaDesc = startRunDate
    ? computeDailyRollingAvg7(trackDailyDescFull).filter((p) => p.date >= startRunDate)
    : computeDailyRollingAvg7(trackDailyDescFull);
  const track24h = trackDailyWithMaDesc[0]?.daily ?? 0;
  const track7d = sumLastNDays(trackDailyWithMaDesc, 7);
  const track28d = sumLastNDays(trackDailyWithMaDesc, 28);
  const track30d = sumLastNDays(trackDailyWithMaDesc, 30);

  const trackOptions = artistTracks
    .map((t) => ({ 
      isrc: t.isrc, 
      name: t.name ?? t.isrc,
      albumImageUrl: t.spotify_album_image_url ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Artist-wide override annotations for the top charts.
  // Overrides are stored per-track per-run-date; annotate the artist charts for any track override.
  const artistOverrideAnnotationsDataDate: ManualOverrideAnnotation[] = await fetchArtistOverrideAnnotations(svc, {
    artistId,
    artistTracks,
    isrcs,
    startRunDate,
    latestRunDate,
    hideStaleAnnotations,
    overrideBuster,
  });

  // Artist images for dropdown + header. Use the cached path to avoid hammering Spotify on every request.
  // We cap thumbnails to avoid very large, cold-cache Spotify fetches.
  const selectedAndSomeArtistIds = Array.from(
    new Set([artistId, ...artists.slice(0, CATALOG_ARTIST_THUMBNAILS_MAX).map((a) => a.id)].filter(Boolean)),
  );
  const artistDataMap = await getArtistsCached(svc, selectedAndSomeArtistIds, { maxAgeDays: 31 });
  const selectedArtistImageUrl = artistDataMap.get(artistId)?.imageUrl ?? null;
  const artistsWithImages = artists.map((a) => ({
    ...a,
    imageUrl: artistDataMap.get(a.id)?.imageUrl ?? null,
  }));

  // Fetch selected track details if isrc is available
  let selectedTrack: { 
    name: string | null; 
    albumImageUrl: string | null; 
    spotifyTrackId: string | null;
    artistNames: string[] | null;
    artistIds: string[] | null;
    releaseDate: string | null;
  } | null = null;
  if (isrc) {
    const { data: trackData } = await cachedQuery(
      async () =>
        await svc
          .from("tracks")
          .select("name,spotify_album_image_url,spotify_track_id,spotify_artist_names,spotify_artist_ids,release_date")
          .eq("isrc", isrc)
          .maybeSingle(),
      `track-selected-${isrc}`,
      CACHE_TTL_1H,
    );
    if (trackData) {
      const track = trackData as {
        name: string | null;
        spotify_album_image_url: string | null;
        spotify_track_id: string | null;
        spotify_artist_names: string[] | null;
        spotify_artist_ids: string[] | null;
        release_date: string | null;
      };
      selectedTrack = {
        name: track.name ?? null,
        albumImageUrl: track.spotify_album_image_url ?? null,
        spotifyTrackId: track.spotify_track_id ?? null,
        artistNames: track.spotify_artist_names ?? null,
        artistIds: track.spotify_artist_ids ?? null,
        releaseDate: (track.release_date ?? "").trim() || null,
      };
    }
  }

  // Selected track playlist memberships (active as-of latestRunDate)
  const selectedTrackPlaylistMemberships = await fetchSelectedTrackPlaylistMemberships(svc, { isrc, latestRunDate });

  return (
    <div className="space-y-4">
      <CatalogPageClient
        latestCum={latestCum}
        latestDate={latestRunDate}
        latestDataDate={latestRunDate ? dataDateFromRunDate(latestRunDate) : null}
        rangeDays={rangeDays}
        cumSeriesAsc={cumSeriesAsc}
        dailyArtistDesc={dailyArtistDesc}
        artist24h={artist24h}
        artist7d={artist7d}
        artist28d={artist28d}
        artist30d={artist30d}
        trackCount={artistTracks.length}
        artists={artistsWithImages}
        artistId={artistId}
        tracks={trackOptions}
        isrc={isrc}
        artistName={artistName}
        artistImageUrl={selectedArtistImageUrl}
        topByCumulative={topByCumulative}
        topByDaily={topByDaily}
        selectedTrack={selectedTrack}
        trackCumDesc={trackCumDesc}
        trackDailyWithMaDesc={trackDailyWithMaDesc}
        trackOverrideAnnotations={trackOverrideAnnotationsDataDate}
        artistOverrideAnnotations={artistOverrideAnnotationsDataDate}
        track24h={track24h}
        track7d={track7d}
        track28d={track28d}
        track30d={track30d}
        selectedTrackPlaylistMemberships={selectedTrackPlaylistMemberships}
      />
    </div>
  );
  } catch (error) {
    // Re-throw redirect errors - they should not be caught
    if (error && typeof error === "object" && "digest" in error) {
      const digest = String((error as { digest?: string }).digest);
      if (digest.startsWith("NEXT_REDIRECT")) {
        throw error;
      }
    }
    logError("Error in CatalogPage", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return (
      <div className="space-y-4">
        <Alert variant="error" title="Error loading catalog page">
          {errorMessage}
        </Alert>
      </div>
    );
  }
}
