import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { cachedQuery } from "@/lib/supabase/cache";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { computeDailyRollingAvg7 } from "@/components/charts/chartUtils";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { Alert } from "@/components/ui/Alert";
import { CACHE_TTL_1H } from "@/lib/constants";
import { logError } from "@/lib/logger";
import { lastArtistIdStorageKey } from "@/lib/datasetSelectionStorage";
import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import type { RequestAppContext } from "@/lib/requestAppContext.server";
import { resolveCatalogTrackSelection } from "@/lib/catalogSelection";

import { CatalogPageClient } from "./CatalogPageClient";
import { CatalogArtistUnavailable, CatalogTrackUnavailable } from "./CatalogUnavailable";
import { fetchCatalogArtistSeries } from "./catalogPageQueries";
import {
  MA7_LOOKBACK_DAYS,
  addDays,
  catalogSelectionHref,
  deriveArtists,
  sumLastNDays,
  type CatalogArtistSeriesRow,
  type CatalogSearchParams,
  type PlaylistDailyStatsRow,
  type TrackRow,
} from "./catalogPageUtils";

/**
 * Competitor Mode branch of the catalog page. Reads the isolated `competitor`
 * schema for the selected competitor label. Awaited inside the page's
 * try/catch so errors and redirects behave exactly like the own-catalog path.
 */
export async function renderCompetitorCatalogContent({
  sp,
  rangeDays,
  svc,
  datasetSettings,
}: {
  sp: CatalogSearchParams;
  rangeDays: number;
  svc: RequestAppContext["svc"];
  datasetSettings: RequestAppContext["settings"];
}) {
  const rollbackDate = await getRollbackDate();
  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;
  const comp = svc.schema("competitor");
  let competitorOverrideVersion = "0";
  try {
    const { data } = await comp.rpc("spotibase_override_version");
    if (typeof data === "string" && data) competitorOverrideVersion = data;
  } catch {
    // The generic revalidation tag remains a fallback during migration rollout.
  }
  let competitorLabelKey =
    typeof datasetSettings?.competitor_label_key === "string" && datasetSettings.competitor_label_key.trim()
      ? datasetSettings.competitor_label_key.trim()
      : null;
  if (!competitorLabelKey) {
    const { data: labels } = await comp
      .from("labels")
      .select("label_key,display_name")
      .eq("is_active", true)
      .order("display_name", { ascending: true });
    competitorLabelKey = resolveCompetitorLabelKey(
      null,
      (labels ?? []) as Array<{ label_key: string; display_name: string }>,
    );
  }
  const artistId = (sp.artist_id ?? "").trim();
  const requestedIsrc = (sp.isrc ?? "").trim();

  // The whole label context (playlists → latest date → memberships → tracks)
  // is identical for every request within a label, so fetch it once per hour
  // per label (this path previously had no caching at all — every catalog
  // render in competitor mode was a full cold ~6-query read).
  type CompCatalogContext = {
    competitorPlaylistRows: Array<{
      playlist_key: string;
      display_name: string | null;
      display_order: number | null;
      spotify_playlist_id: string | null;
      spotify_playlist_image_url: string | null;
    }>;
    latestRunDate: string | null;
    hasOnlyOneSnapshot: boolean;
    activeMemberships: Array<{ isrc: string; playlist_key: string; valid_from: string }>;
    competitorTracks: TrackRow[];
  };
  const { data: compContext } = await cachedQuery<CompCatalogContext>(
    async () => {
      let competitorPlaylistsQuery = comp
        .from("playlists")
        .select("playlist_key,display_name,display_order,spotify_playlist_id,spotify_playlist_image_url")
        .eq("is_active", true);
      if (competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY) {
        competitorPlaylistsQuery = competitorPlaylistsQuery.eq("label_key", competitorLabelKey);
      }
      const { data: competitorPlaylists } = competitorLabelKey
        ? await competitorPlaylistsQuery
        : { data: [] as CompCatalogContext["competitorPlaylistRows"] };
      const competitorPlaylistRows = (competitorPlaylists ?? []) as CompCatalogContext["competitorPlaylistRows"];
      const competitorPlaylistKeys = competitorPlaylistRows
        .map((p) => p.playlist_key)
        .filter(Boolean);
      const [{ data: latestRun }, { data: recentPlaylistDates }] = competitorPlaylistKeys.length
        ? await Promise.all([
            (() => {
              let q = comp.from("playlist_daily_stats").select("date").in("playlist_key", competitorPlaylistKeys);
              if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
              return q.order("date", { ascending: false }).limit(1).maybeSingle();
            })(),
            (() => {
              let q = comp.from("playlist_daily_stats").select("date").in("playlist_key", competitorPlaylistKeys);
              if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
              return q.order("date", { ascending: false }).limit(Math.max(competitorPlaylistKeys.length * 2, 2));
            })(),
          ])
        : [{ data: null }, { data: [] as PlaylistDailyStatsRow[] }];
      const latestRunDate = (latestRun as PlaylistDailyStatsRow | null)?.date ?? null;
      const hasOnlyOneSnapshot =
        new Set(((recentPlaylistDates ?? []) as PlaylistDailyStatsRow[]).map((row) => row.date)).size <= 1;
      const { data: activeMemberships } =
        latestRunDate && competitorPlaylistKeys.length
          ? await comp
              .from("playlist_memberships")
              .select("isrc,playlist_key,valid_from")
              .in("playlist_key", competitorPlaylistKeys)
              .lte("valid_from", latestRunDate)
              .or(`valid_to.is.null,valid_to.gte.${latestRunDate}`)
          : { data: [] as CompCatalogContext["activeMemberships"] };
      const competitorIsrcs = [
        ...new Set(
          ((activeMemberships ?? []) as Array<{ isrc: string }>).map((r) => r.isrc).filter(Boolean),
        ),
      ];
      const { data: recentTracks } = competitorIsrcs.length
        ? await comp
            .from("tracks")
            .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url,release_date")
            .in("isrc", competitorIsrcs)
            .not("spotify_artist_ids", "is", null)
            .order("last_seen", { ascending: false })
            .limit(5000)
        : { data: [] as TrackRow[] };
      return {
        data: {
          competitorPlaylistRows,
          latestRunDate,
          hasOnlyOneSnapshot,
          activeMemberships: (activeMemberships ?? []) as CompCatalogContext["activeMemberships"],
          competitorTracks: (recentTracks ?? []) as TrackRow[],
        },
        error: null,
      };
    },
    `catalog-comp-context-v1-${competitorLabelKey ?? "none"}-rb${rollbackDate ?? "live"}`,
    CACHE_TTL_1H,
  );
  const competitorPlaylistRows = compContext?.competitorPlaylistRows ?? [];
  const latestRunDate = compContext?.latestRunDate ?? null;
  const hasOnlyOneSnapshot = compContext?.hasOnlyOneSnapshot ?? true;
  const activeMemberships = compContext?.activeMemberships ?? [];
  let competitorTracks = compContext?.competitorTracks ?? [];
  const competitorPlaylistMetaByKey = new Map(competitorPlaylistRows.map((p) => [p.playlist_key, p]));

  if (requestedIsrc) {
    const requestedTrackInScope = competitorTracks.find((track) => track.isrc === requestedIsrc) ?? null;
    let resolvedTrack = requestedTrackInScope;
    let resolvedTrackIsActiveInScope = Boolean(
      requestedTrackInScope || activeMemberships.some((membership) => membership.isrc === requestedIsrc),
    );

    if (!resolvedTrack) {
      const { data: trackRow, error: trackError } = await cachedQuery(
        async () =>
          await comp
            .from("tracks")
            .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url,release_date")
            .eq("isrc", requestedIsrc)
            .maybeSingle(),
        `catalog-comp-requested-track-v1-${requestedIsrc}`,
        CACHE_TTL_1H,
      );
      if (trackError) {
        logError("Error resolving requested competitor track", trackError);
        return (
          <Alert variant="error" title="Error resolving track">
            {trackError.message}
          </Alert>
        );
      }
      resolvedTrack = (trackRow ?? null) as TrackRow | null;
    }

    if (
      resolvedTrack &&
      !resolvedTrackIsActiveInScope &&
      latestRunDate &&
      competitorPlaylistRows.length > 0
    ) {
      const playlistKeys = competitorPlaylistRows.map((playlist) => playlist.playlist_key);
      const { data: activeMembership, error: membershipError } = await cachedQuery(
        async () =>
          await comp
            .from("playlist_memberships")
            .select("isrc")
            .eq("isrc", requestedIsrc)
            .in("playlist_key", playlistKeys)
            .lte("valid_from", latestRunDate)
            .or(`valid_to.is.null,valid_to.gte.${latestRunDate}`)
            .limit(1)
            .maybeSingle(),
        `catalog-comp-requested-track-active-v1-${competitorLabelKey ?? "none"}-${requestedIsrc}-${latestRunDate}`,
        CACHE_TTL_1H,
      );
      if (membershipError) {
        logError("Error resolving requested competitor track membership", membershipError);
        return (
          <Alert variant="error" title="Error resolving track availability">
            {membershipError.message}
          </Alert>
        );
      }
      resolvedTrackIsActiveInScope = Boolean(activeMembership);
    }

    const selection = resolveCatalogTrackSelection({
      requestedArtistId: artistId,
      requestedIsrc,
      artistTracks: artistId
        ? competitorTracks.filter((track) =>
            (track.spotify_artist_ids ?? []).includes(artistId),
          )
        : [],
      resolvedTrack,
      resolvedTrackIsActiveInScope,
    });

    if (selection.kind === "redirect") {
      redirect(catalogSelectionHref(sp, selection.artistId, selection.isrc));
    }
    if (selection.kind === "unavailable") {
      return (
        <CatalogTrackUnavailable
          datasetMode="competitor"
          isrc={requestedIsrc}
          reason={selection.reason}
        />
      );
    }
    if (selection.shouldInject) {
      competitorTracks = [selection.track, ...competitorTracks];
    }
  }

  const artists = deriveArtists(competitorTracks);
  const effectiveArtistId = artistId || artists[0]?.id || "";
  if (!artistId && effectiveArtistId) {
    // Client-side param fill (same as own catalog) rather than a server
    // redirect: renders a loading card immediately instead of a blank screen
    // while a second full server render runs, and honours the last artist
    // opened in Competitor Mode. Existing params (range/isrc) are preserved
    // by the component; a stale isrc self-corrects on the next render.
    return (
      <RememberParamRedirect
        param="artist_id"
        storageKey={lastArtistIdStorageKey("competitor")}
        defaultValue={effectiveArtistId}
        loadingTitle="Opening your last artist…"
        loadingSubtitle="If this is your first time, we’ll pick the first artist we find."
      />
    );
  }
  if (
    artistId &&
    !artists.some((artist) => artist.id === artistId)
  ) {
    return (
      <CatalogArtistUnavailable
        datasetMode="competitor"
        artistId={artistId}
        fallbackHref={artists[0]?.id ? `/catalog?artist_id=${encodeURIComponent(artists[0].id)}` : null}
      />
    );
  }
  const artistTracks = competitorTracks.filter((t) => (t.spotify_artist_ids ?? []).includes(effectiveArtistId));
  const selectedIsrc = requestedIsrc || artistTracks[0]?.isrc || null;
  const startRunDate = latestRunDate ? addDays(latestRunDate, -rangeDays) : null;
  const maPaddedStartRunDate = startRunDate ? addDays(startRunDate, -MA7_LOOKBACK_DAYS) : null;
  const artistIsrcs = artistTracks.map((t) => t.isrc);
  const compArtistCacheKey = `catalog-comp-artist-v1-${competitorLabelKey ?? "none"}-${effectiveArtistId}-${latestRunDate ?? "none"}-${rangeDays}-ov${competitorOverrideVersion}`;
  const [{ data: artistSeriesRaw }, { data: todayRowsRaw }, { data: prevRowsRaw }] = await Promise.all([
    latestRunDate && maPaddedStartRunDate && artistIsrcs.length
      ? cachedQuery(
          async () =>
            await fetchCatalogArtistSeries(comp as unknown as SupabaseClient, {
              artistId: effectiveArtistId,
              startDate: maPaddedStartRunDate,
              endDate: latestRunDate,
            }),
          `${compArtistCacheKey}-series`,
          CACHE_TTL_1H,
        )
      : Promise.resolve({ data: [] }),
    latestRunDate && artistIsrcs.length
      ? cachedQuery(
          async () =>
            await comp
              .from("track_daily_streams_effective_public")
              .select("isrc,streams_cumulative")
              .in("isrc", artistIsrcs)
              .eq("date", latestRunDate),
          `${compArtistCacheKey}-today`,
          CACHE_TTL_1H,
        )
      : Promise.resolve({ data: [] }),
    latestRunDate && artistIsrcs.length
      ? cachedQuery(
          async () =>
            await comp
              .from("track_daily_streams_effective_public")
              .select("isrc,streams_cumulative")
              .in("isrc", artistIsrcs)
              .eq("date", addDays(latestRunDate, -1)),
          `${compArtistCacheKey}-prev`,
          CACHE_TTL_1H,
        )
      : Promise.resolve({ data: [] }),
  ]);
  const seriesByDate = new Map<string, number>();
  for (const row of (artistSeriesRaw ?? []) as Array<{ date: string; streams_cumulative: number | null }>) {
    seriesByDate.set(row.date, (seriesByDate.get(row.date) ?? 0) + Number(row.streams_cumulative ?? 0));
  }
  const seriesRows = [...seriesByDate.entries()].map(([date, streams_cumulative]) => ({ date, streams_cumulative }));
  const todayByIsrc = new Map(
    ((todayRowsRaw ?? []) as Array<{ isrc: string; streams_cumulative: number | null }>).map((r) => [
      r.isrc,
      Number(r.streams_cumulative ?? 0),
    ]),
  );
  const prevByIsrc = new Map(
    ((prevRowsRaw ?? []) as Array<{ isrc: string; streams_cumulative: number | null }>).map((r) => [
      r.isrc,
      Number(r.streams_cumulative ?? 0),
    ]),
  );
  const topRows = artistTracks.map((t) => ({
    isrc: t.isrc,
    name: t.name,
    album_image_url: t.spotify_album_image_url,
    total: todayByIsrc.has(t.isrc) ? todayByIsrc.get(t.isrc)! : null,
    daily:
      todayByIsrc.has(t.isrc) && prevByIsrc.has(t.isrc)
        ? todayByIsrc.get(t.isrc)! - prevByIsrc.get(t.isrc)!
        : null,
  }));
  const topTotalRows = [...topRows].sort((a, b) => Number(b.total ?? -Infinity) - Number(a.total ?? -Infinity));
  const topDailyRows = [...topRows].sort((a, b) => Number(b.daily ?? -Infinity) - Number(a.daily ?? -Infinity));
  const cumSeriesAscRunFull = ((seriesRows ?? []) as CatalogArtistSeriesRow[])
    .map((r) => ({ date: r.date, value: Number(r.streams_cumulative ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const cumSeriesAscRun = startRunDate ? cumSeriesAscRunFull.filter((p) => p.date >= startRunDate) : cumSeriesAscRunFull;
  const dailyArtistAscRunFull = cumSeriesAscRunFull.map((p, idx) => ({
    date: p.date,
    daily: idx === 0 ? null : p.value - cumSeriesAscRunFull[idx - 1].value,
  }));
  const dailyArtistDesc = computeDailyRollingAvg7([...dailyArtistAscRunFull].reverse());
  const trackSeries =
    selectedIsrc && latestRunDate && maPaddedStartRunDate
      ? ((
          await cachedQuery(
            async () =>
              await comp
                .from("track_daily_streams_effective_public")
                .select("date,streams_cumulative")
                .eq("isrc", selectedIsrc)
                .gte("date", maPaddedStartRunDate)
                .lte("date", latestRunDate)
                .order("date", { ascending: false }),
            `catalog-comp-track-series-v1-${selectedIsrc}-${maPaddedStartRunDate}-${latestRunDate}-ov${competitorOverrideVersion}`,
            CACHE_TTL_1H,
          )
        ).data ?? [])
      : [];
  const trackCumDesc = (trackSeries ?? []).map((r) => ({ date: r.date, value: Number(r.streams_cumulative ?? 0) }));
  const trackDailyAsc = [...trackCumDesc].reverse().map((p, idx, arr) => ({
    date: p.date,
    daily: idx === 0 ? null : p.value - arr[idx - 1].value,
  }));
  const trackDailyWithMaDesc = computeDailyRollingAvg7([...trackDailyAsc].reverse());
  const artistName = artists.find((a) => a.id === effectiveArtistId)?.name ?? effectiveArtistId;
  const selectedTrackRow = artistTracks.find((t) => t.isrc === selectedIsrc) ?? null;
  const selectedTrackPlaylistMemberships =
    selectedIsrc && latestRunDate
      ? ((activeMemberships ?? []) as Array<{ isrc: string; playlist_key: string; valid_from: string }>)
          .filter((m) => m.isrc === selectedIsrc)
          .map((m) => {
            const meta = competitorPlaylistMetaByKey.get(m.playlist_key) ?? null;
            return {
              playlistKey: m.playlist_key,
              playlistName: meta?.display_name ?? m.playlist_key,
              playlistType: "Competitor",
              displayOrder: meta?.display_order ?? null,
              addedRunDate: m.valid_from,
              removedRunDate: null,
              spotifyPlaylistId: meta?.spotify_playlist_id ?? null,
              spotifyPlaylistImageUrl: meta?.spotify_playlist_image_url ?? null,
              isCatalog: false,
            };
          })
      : [];
  return (
    <div className="space-y-4">
      <CatalogPageClient
        mode="competitor"
        hasOnlyOneSnapshot={hasOnlyOneSnapshot}
        latestCum={cumSeriesAscRun.at(-1)?.value ?? 0}
        latestDate={latestRunDate}
        latestDataDate={latestRunDate ? dataDateFromRunDate(latestRunDate) : null}
        rangeDays={rangeDays}
        cumSeriesAsc={cumSeriesAscRun}
        dailyArtistDesc={dailyArtistDesc}
        artist24h={dailyArtistDesc[0]?.daily ?? 0}
        artist7d={sumLastNDays(dailyArtistDesc, 7)}
        artist28d={sumLastNDays(dailyArtistDesc, 28)}
        artist30d={sumLastNDays(dailyArtistDesc, 30)}
        trackCount={artistTracks.length}
        artists={artists.map((a) => ({ ...a, imageUrl: null }))}
        artistId={effectiveArtistId}
        tracks={artistTracks.map((t) => ({ isrc: t.isrc, name: t.name ?? t.isrc, albumImageUrl: t.spotify_album_image_url ?? null }))}
        isrc={selectedIsrc}
        artistName={artistName}
        artistImageUrl={null}
        topByCumulative={(topTotalRows ?? []) as any}
        topByDaily={(topDailyRows ?? []) as any}
        selectedTrack={
          selectedTrackRow
            ? {
                name: selectedTrackRow.name,
                albumImageUrl: selectedTrackRow.spotify_album_image_url ?? null,
                spotifyTrackId: null,
                artistNames: selectedTrackRow.spotify_artist_names ?? null,
                artistIds: selectedTrackRow.spotify_artist_ids ?? null,
                releaseDate: selectedTrackRow.release_date ?? null,
              }
            : null
        }
        trackCumDesc={trackCumDesc}
        trackDailyWithMaDesc={trackDailyWithMaDesc}
        trackOverrideAnnotations={[]}
        artistOverrideAnnotations={[]}
        track24h={trackDailyWithMaDesc[0]?.daily ?? 0}
        track7d={sumLastNDays(trackDailyWithMaDesc, 7)}
        track28d={sumLastNDays(trackDailyWithMaDesc, 28)}
        track30d={sumLastNDays(trackDailyWithMaDesc, 30)}
        selectedTrackPlaylistMemberships={selectedTrackPlaylistMemberships}
      />
    </div>
  );
}
