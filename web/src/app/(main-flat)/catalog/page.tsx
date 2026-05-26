import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { getArtistsCached } from "@/lib/spotify";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { CatalogPageClient } from "./CatalogPageClient";
import { computeDailyRollingAvg7 } from "@/components/charts/chartUtils";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { getRollbackDate, rollbackDataDateToRunDate, capRunDate } from "@/lib/rollback";
import { Alert } from "@/components/ui/Alert";
import { CACHE_TTL_1H, API_LOOKUP_DROPDOWN_MAX, API_LOOKUP_THUMBNAILS_MAX, API_LOOKUP_PAGE_SIZE, API_LOOKUP_TRACK_MAX, API_LOOKUP_LIMIT_500 } from "@/lib/constants";
import { logError, logWarn } from "@/lib/logger";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { isMissingPostgresFunctionError } from "@/lib/supabase/rpcErrors";

const CATALOG_ARTIST_DROPDOWN_MAX_TRACKS = API_LOOKUP_DROPDOWN_MAX;
const CATALOG_ARTIST_THUMBNAILS_MAX = API_LOOKUP_THUMBNAILS_MAX;

/** Extra days to load before the chart range so MA7 matches home (window uses days before the first visible day). */
const MA7_LOOKBACK_DAYS = 6;

function sumLastNDays(desc: Array<{ date: string; daily: number | null }>, days: number) {
  return desc.slice(0, days).reduce((acc, r) => acc + Number(r.daily ?? 0), 0);
}

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalog",
};

type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_artist_ids: string[] | null;
  spotify_artist_names: string[] | null;
  spotify_album_image_url: string | null;
  release_date?: string | null;
};

type TrackDailyRow = {
  date: string;
  isrc: string;
  streams_cumulative: number | null;
};

type TrackOverrideRow = {
  date: string;
  note: string | null;
};

type TrackOverrideRowWithIsrc = {
  date: string;
  isrc: string;
  note: string | null;
};

type ManualOverrideAnnotation = {
  date: string;
  note: string;
  title?: string;
  imageUrl?: string | null;
};

type PlaylistDailyStatsRow = { date: string };
type CatalogArtistSeriesRow = { date: string; streams_cumulative: number | null };
type CatalogTopTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  total: number | null;
  daily: number | null;
};
type PlaylistMembershipRow = {
  playlist_key: string;
  valid_from: string;
  valid_to: string | null;
};

type PlaylistMetaRow = {
  playlist_key: string;
  display_name: string | null;
  is_catalog: boolean | null;
  playlist_type: string | null;
  display_order: number | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
};

function clampRangeDays(x: unknown) {
  const n = Number(x ?? "30") || 30;
  return Math.max(7, Math.min(365, n));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

async function fetchAllTracksMeta(
  sb: SupabaseClient,
  maxRows = 5000,
): Promise<TrackRow[]> {
  const pageSize = API_LOOKUP_PAGE_SIZE;
  const out: TrackRow[] = [];
  let from = 0;

  while (from < maxRows) {
    const to = from + pageSize - 1;
    const { data, error } = await sb
      .from("tracks")
      .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url")
      .not("spotify_artist_ids", "is", null)
      .order("last_seen", { ascending: false })
      .range(from, to);

    if (error) {
      logError("Error fetching tracks metadata", error);
      break;
    }

    const rows = (data ?? []) as TrackRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

async function fetchAllTrackSeries(
  sb: SupabaseClient,
  args: { isrc: string; startDate: string; endDate: string; maxRows?: number },
) {
  const pageSize = API_LOOKUP_PAGE_SIZE;
  const out: Array<{ date: string; streams_cumulative: number | null }> = [];
  let from = 0;
  const max = args.maxRows ?? API_LOOKUP_TRACK_MAX;

  while (from < max) {
    const to = from + pageSize - 1;
    const { data } = await sb
      .from("track_daily_streams_effective_public")
      .select("date,streams_cumulative")
      .eq("isrc", args.isrc)
      .gte("date", args.startDate)
      .lte("date", args.endDate)
      .order("date", { ascending: false })
      .range(from, to);

    const rows = (data ?? []) as Array<{ date: string; streams_cumulative: number | null }>;
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

async function fetchCatalogArtistSeries(
  sb: SupabaseClient,
  args: { artistId: string; startDate: string; endDate: string },
) {
  const fast = await sb.rpc("catalog_artist_series_fast", {
    artist_id: args.artistId,
    start_date: args.startDate,
    end_date: args.endDate,
  });
  if (!fast.error || !isMissingPostgresFunctionError(fast.error)) return fast;
  return await sb.rpc("catalog_artist_series", {
    artist_id: args.artistId,
    start_date: args.startDate,
    end_date: args.endDate,
  });
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function deriveArtists(rows: TrackRow[]) {
  const byId = new Map<string, string>();
  for (const t of rows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      const id = ids[i];
      const name = names[i];
      if (!id || !name) continue;
      if (!byId.has(id)) byId.set(id, name);
    }
  }
  return Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function artistNameFor(rows: TrackRow[], artistId: string) {
  for (const t of rows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      if (ids[i] === artistId) return names[i] ?? null;
    }
  }
  return null;
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams?: Promise<{ artist_id?: string; isrc?: string; range?: string; view?: string; start?: string; end?: string }>;
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
    const sb = await supabaseServer();
    const { data: userData } = await sb.auth.getUser();
    if (!userData.user) redirect("/login");

    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) redirect("/");

    // IMPORTANT: Core analytics tables are admin-only via RLS. If we cache queries using
    // a request-scoped Supabase client, revalidation can run without cookies and fail,
    // leaving stale cached data. Use the service-role client for all data reads here;
    // access is still gated above.
    const svc = supabaseService();
    const { data: datasetSettings } = await svc
      .from("user_settings")
      .select("dataset_mode,competitor_label_key")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    const datasetMode = normalizeDatasetMode(datasetSettings?.dataset_mode);

    if (datasetMode === "competitor") {
      const comp = svc.schema("competitor");
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
      let competitorPlaylistsQuery = comp
        .from("playlists")
        .select("playlist_key,display_name,display_order,spotify_playlist_id,spotify_playlist_image_url")
        .eq("is_active", true);
      if (competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY) {
        competitorPlaylistsQuery = competitorPlaylistsQuery.eq("label_key", competitorLabelKey);
      }
      const { data: competitorPlaylists } = competitorLabelKey
        ? await competitorPlaylistsQuery
        : { data: [] as Array<{ playlist_key: string; display_name: string | null; display_order: number | null; spotify_playlist_id: string | null; spotify_playlist_image_url: string | null }> };
      const competitorPlaylistRows = (competitorPlaylists ?? []) as Array<{
        playlist_key: string;
        display_name: string | null;
        display_order: number | null;
        spotify_playlist_id: string | null;
        spotify_playlist_image_url: string | null;
      }>;
      const competitorPlaylistKeys = competitorPlaylistRows
        .map((p) => p.playlist_key)
        .filter(Boolean);
      const competitorPlaylistMetaByKey = new Map(competitorPlaylistRows.map((p) => [p.playlist_key, p]));
      const [{ data: latestRun }, { data: recentPlaylistDates }] = competitorPlaylistKeys.length
        ? await Promise.all([
            comp
              .from("playlist_daily_stats")
              .select("date")
              .in("playlist_key", competitorPlaylistKeys)
              .order("date", { ascending: false })
              .limit(1)
              .maybeSingle(),
            comp
              .from("playlist_daily_stats")
              .select("date")
              .in("playlist_key", competitorPlaylistKeys)
              .order("date", { ascending: false })
              .limit(Math.max(competitorPlaylistKeys.length * 2, 2)),
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
          : { data: [] as Array<{ isrc: string; playlist_key: string; valid_from: string }> };
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
      const competitorTracks = (recentTracks ?? []) as TrackRow[];
      const artists = deriveArtists(competitorTracks);
      const effectiveArtistId = artistId || artists[0]?.id || "";
      if (!artistId && effectiveArtistId) {
        redirect(`/catalog?artist_id=${effectiveArtistId}`);
      }
      const artistTracks = competitorTracks.filter((t) => (t.spotify_artist_ids ?? []).includes(effectiveArtistId));
      const selectedIsrc = requestedIsrc || artistTracks[0]?.isrc || null;
      const startRunDate = latestRunDate ? addDays(latestRunDate, -rangeDays) : null;
      const maPaddedStartRunDate = startRunDate ? addDays(startRunDate, -MA7_LOOKBACK_DAYS) : null;
      const artistIsrcs = artistTracks.map((t) => t.isrc);
      const [{ data: artistSeriesRaw }, { data: todayRowsRaw }, { data: prevRowsRaw }] = await Promise.all([
        latestRunDate && maPaddedStartRunDate && artistIsrcs.length
          ? fetchCatalogArtistSeries(comp as unknown as SupabaseClient, {
              artistId: effectiveArtistId,
              startDate: maPaddedStartRunDate,
              endDate: latestRunDate,
            })
          : Promise.resolve({ data: [] }),
        latestRunDate && artistIsrcs.length
          ? comp
              .from("track_daily_streams")
              .select("isrc,streams_cumulative")
              .in("isrc", artistIsrcs)
              .eq("date", latestRunDate)
          : Promise.resolve({ data: [] }),
        latestRunDate && artistIsrcs.length
          ? comp
              .from("track_daily_streams")
              .select("isrc,streams_cumulative")
              .in("isrc", artistIsrcs)
              .eq("date", addDays(latestRunDate, -1))
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
          ? ((await comp
              .from("track_daily_streams")
              .select("date,streams_cumulative")
              .eq("isrc", selectedIsrc)
              .gte("date", maPaddedStartRunDate)
              .lte("date", latestRunDate)
              .order("date", { ascending: false })).data ?? [])
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

    let hideStaleAnnotations = false;
    try {
      const { data: uSettings } = await sb
        .from("user_settings")
        .select("hide_stale_override_annotations, hide_stale_annotations_exclude_catalog")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      const row = uSettings as Record<string, unknown> | null;
      const wantsHide = Boolean(row?.hide_stale_override_annotations);
      const excludeCatalog = Boolean(row?.hide_stale_annotations_exclude_catalog);
      hideStaleAnnotations = wantsHide && !excludeCatalog;
    } catch {
      // graceful fallback
    }

    // Cache-buster: include count + max(id) in cache keys so both additions AND
    // removals of overrides invalidate stale catalog aggregate caches.
    let overrideBuster = "0";
    try {
      const { count, data: latestOverride } = await svc
        .from("track_daily_stream_overrides")
        .select("id", { count: "exact" })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      const maxId = Number((latestOverride as { id: number } | null)?.id ?? 0);
      const total = Number(count ?? 0);
      overrideBuster = `${total}-${maxId}`;
    } catch {
      // ignore (table may not exist yet)
    }

    const artistId = (sp.artist_id ?? "").trim();
    const requestedIsrc = (sp.isrc ?? "").trim();

    // If a track is specified without an artist, prefer the track's primary (first) artist.
    // This makes "click a track → open Catalog" land on the correct artist automatically.
    if (!artistId && requestedIsrc) {
      const { data: trackRow } = await cachedQuery(
        async () =>
          await svc
            .from("tracks")
            .select("spotify_artist_ids")
            .eq("isrc", requestedIsrc)
            .maybeSingle(),
        `catalog-isrc-primary-artist-${requestedIsrc}`,
        CACHE_TTL_1H,
      );

      const typed = (trackRow ?? null) as { spotify_artist_ids: string[] | null } | null;
      const primaryArtistId = Array.isArray(typed?.spotify_artist_ids)
        ? String(typed?.spotify_artist_ids?.[0] ?? "").trim()
        : "";

      if (primaryArtistId) {
        const params = new URLSearchParams();
        params.set("artist_id", primaryArtistId);
        params.set("isrc", requestedIsrc);
        if (sp.range) params.set("range", String(clampRangeDays(sp.range)));
        redirect(`/catalog?${params.toString()}`);
      }
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
          storageKey="sb:last_artist_id"
          defaultValue={defaultArtistId || null}
          loadingTitle="Opening your last artist…"
          loadingSubtitle="If this is your first time, we'll pick the first artist we find."
        />
      );
    }

    // We don't have an artists table; derive a bounded list of artists from tracks.
    // Note: This is intentionally capped for performance. For long-tail discovery, use the global search bar.
    const trackMetaRows = await cachedQuery(
      async () => ({
        data: await fetchAllTracksMeta(svc, CATALOG_ARTIST_DROPDOWN_MAX_TRACKS),
        error: null,
      }),
      `catalog-artists-from-tracks-v2-${CATALOG_ARTIST_DROPDOWN_MAX_TRACKS}`,
      CACHE_TTL_1H,
    );
    const artists = deriveArtists((trackMetaRows.data ?? []) as TrackRow[]);

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

  const artistTracks = (tracks ?? []) as TrackRow[];
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
  const distroByIsrc = new Map<string, { name: string; imageUrl: string | null }>();
  if (latestRunDate && topIsrcs.size > 0) {
    const allTopIsrcs = Array.from(topIsrcs).filter(Boolean);
    const { data: distroMemRows } = await cachedQuery(
      async () =>
        await svc
          .from("playlist_memberships")
          .select("isrc,playlist_key,valid_to")
          .in("isrc", allTopIsrcs)
          .lte("valid_from", latestRunDate),
      `catalog-top-distro-memberships-${artistId}-${latestRunDate}`,
      CACHE_TTL_1H,
    );
    const activeMemRows = ((distroMemRows ?? []) as Array<{ isrc: string; playlist_key: string; valid_to: string | null }>)
      .filter((r) => r.valid_to == null || r.valid_to >= latestRunDate);
    const uniquePlaylistKeys = [...new Set(activeMemRows.map((r) => r.playlist_key))];
    if (uniquePlaylistKeys.length) {
      const { data: distroPlaylistRows } = await cachedQuery(
        async () =>
          await svc
            .from("playlists")
            .select("playlist_key,display_name,spotify_playlist_image_url")
            .in("playlist_key", uniquePlaylistKeys)
            .eq("playlist_type", "Distro"),
        `catalog-top-distro-playlists-${artistId}-${latestRunDate}`,
        CACHE_TTL_1H,
      );
      const distroPlaylistMap = new Map(
        ((distroPlaylistRows ?? []) as Array<{ playlist_key: string; display_name: string | null; spotify_playlist_image_url: string | null }>)
          .map((p) => [p.playlist_key, { name: p.display_name ?? p.playlist_key, imageUrl: p.spotify_playlist_image_url ?? null }]),
      );
      for (const r of activeMemRows) {
        const info = distroPlaylistMap.get(r.playlist_key);
        if (info && !distroByIsrc.has(r.isrc)) distroByIsrc.set(r.isrc, info);
      }
    }
  }

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
  const artistOverrideAnnotationsDataDate: ManualOverrideAnnotation[] = await (async () => {
    if (!latestRunDate || !startRunDate) return [];
    if (!isrcs.length) return [];

    const metaByIsrc = new Map<string, TrackRow>();
    for (const t of artistTracks) {
      if (!t?.isrc) continue;
      metaByIsrc.set(t.isrc, t);
    }

    const chunks = chunk(isrcs, 200);

    // Fetch all chunks in parallel — each is independently cached.
    const chunkResults = await Promise.all(
      chunks.map((isrcChunk, i) =>
        cachedQuery(
          async () => {
            let q = svc
              .from("track_daily_stream_overrides")
              .select("date,isrc,note")
              .in("isrc", isrcChunk)
              .gte("date", startRunDate)
              .lte("date", latestRunDate);
            if (hideStaleAnnotations) q = q.not("note", "like", "stale-fix:%");
            return await q.order("date", { ascending: false }).limit(API_LOOKUP_LIMIT_500);
          },
          `catalog-artist-overrides-${artistId}-${startRunDate}-${latestRunDate}-c${i}-ov${overrideBuster}-stale${hideStaleAnnotations ? "1" : "0"}`,
          CACHE_TTL_1H,
        ),
      ),
    );

    const rowsAll: TrackOverrideRowWithIsrc[] = chunkResults.flatMap(
      ({ data: rowsRaw }) => (rowsRaw ?? []) as TrackOverrideRowWithIsrc[],
    );

    const deduped: TrackOverrideRowWithIsrc[] = [];
    const seen = new Set<string>();
    for (const r of rowsAll) {
      const d = (r?.date ?? "").trim();
      const isrc = (r?.isrc ?? "").trim();
      if (!d || !isrc) continue;
      const key = `${d}||${isrc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ date: d, isrc, note: r.note ?? null });
    }

    deduped.sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return a.isrc.localeCompare(b.isrc);
    });

    return deduped.slice(0, 500).map((o) => {
      const t = metaByIsrc.get(o.isrc) ?? null;
      const artist = t?.spotify_artist_names?.[0] ?? null;
      const trackName = t?.name ?? null;
      const title =
        artist && trackName
          ? `${artist} - ${trackName}`
          : trackName
            ? trackName
            : artist
              ? artist
              : o.isrc;

      return {
        date: dataDateFromRunDate(o.date),
        title,
        imageUrl: t?.spotify_album_image_url ?? null,
        note: (o.note ?? "").trim() || `Manual override (ISRC: ${o.isrc})`,
      };
    });
  })();

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
  const selectedTrackPlaylistMemberships = await (async () => {
    if (!isrc || !latestRunDate) return [];

    const { data: membershipRows, error: membershipErr } = await cachedQuery(
      async () =>
        await svc
          .from("playlist_memberships")
          .select("playlist_key,valid_from,valid_to")
          .eq("isrc", isrc)
          .lte("valid_from", latestRunDate)
          .order("playlist_key", { ascending: true })
          .order("valid_from", { ascending: false })
          .limit(API_LOOKUP_TRACK_MAX),
      `catalog-track-playlist-memberships-v1-${isrc}-${latestRunDate}`,
      CACHE_TTL_1H,
    );

    if (membershipErr) {
      logWarn("Error fetching track playlist memberships", membershipErr);
      return [];
    }

    const latestByPlaylist = new Map<string, PlaylistMembershipRow>();
    for (const r of (membershipRows ?? []) as PlaylistMembershipRow[]) {
      const key = String(r?.playlist_key ?? "").trim();
      if (!key) continue;
      if (!latestByPlaylist.has(key)) latestByPlaylist.set(key, r);
    }

    const latestRows = Array.from(latestByPlaylist.values());
    const playlistKeys = latestRows
      .map((r) => String(r.playlist_key ?? "").trim())
      .filter(Boolean);
    if (!playlistKeys.length) return [];

    // Fetch playlist metadata. Playlist config changes rarely (display_name, type, image);
    // cache for 1h so repeated track selections don't re-query on every page load.
    // Also provide a fallback if `playlist_type`/`display_order` columns don't exist yet.
    let playlistMetaRows: unknown[] = [];
    try {
      const { data: cachedMeta } = await cachedQuery(
        async () => {
          const res = await svc
            .from("playlists")
            .select(
              "playlist_key,display_name,is_catalog,playlist_type,display_order,spotify_playlist_id,spotify_playlist_image_url",
            )
            .in("playlist_key", playlistKeys);

          if (
            res.error &&
            (String(res.error.message ?? "").includes("playlist_type") ||
              String(res.error.message ?? "").includes("display_order"))
          ) {
            return svc
              .from("playlists")
              .select("playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url")
              .in("playlist_key", playlistKeys);
          }

          return res;
        },
        `catalog-track-playlist-meta-${playlistKeys.sort().join(",")}`,
        CACHE_TTL_1H,
      );
      playlistMetaRows = (cachedMeta ?? []) as unknown[];
    } catch (e) {
      logWarn("Error fetching playlist metadata", e);
    }

    const metaByKey = new Map<string, PlaylistMetaRow>();
    for (const r of (playlistMetaRows ?? []) as PlaylistMetaRow[]) {
      const key = String(r?.playlist_key ?? "").trim();
      if (!key) continue;
      metaByKey.set(key, r);
    }

    const out = latestRows.map((r) => {
      const key = String(r.playlist_key ?? "").trim();
      const meta = metaByKey.get(key) ?? null;
      const playlistTypeRaw = (meta?.playlist_type ?? "").trim();
      const playlistType =
        playlistTypeRaw || (meta?.is_catalog ? "Catalog" : "Standard");
      return {
        playlistKey: key,
        playlistName: (meta?.display_name ?? "").trim() || key,
        playlistType,
        displayOrder: typeof meta?.display_order === "number" ? meta.display_order : null,
        addedRunDate: String(r.valid_from).slice(0, 10),
        removedRunDate: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
        spotifyPlaylistId: meta?.spotify_playlist_id ?? null,
        spotifyPlaylistImageUrl: meta?.spotify_playlist_image_url ?? null,
        isCatalog: Boolean(meta?.is_catalog),
      };
    });

    out.sort((a, b) => {
      // Match /playlists/config ordering:
      // 1) display_order ASC (NULLS LAST)
      // 2) is_catalog DESC
      // 3) display_name ASC
      const ao = a.displayOrder;
      const bo = b.displayOrder;
      const aHas = ao != null && Number.isFinite(ao);
      const bHas = bo != null && Number.isFinite(bo);
      if (aHas && bHas && ao !== bo) return ao - bo;
      if (aHas !== bHas) return aHas ? -1 : 1;

      const ac = a.isCatalog ? 1 : 0;
      const bc = b.isCatalog ? 1 : 0;
      if (ac !== bc) return bc - ac;

      const n = a.playlistName.localeCompare(b.playlistName);
      if (n !== 0) return n;
      return a.playlistKey.localeCompare(b.playlistKey);
    });
    return out;
  })();

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
