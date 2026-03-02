import { redirect } from "next/navigation";
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

const CATALOG_ARTIST_DROPDOWN_MAX_TRACKS = 10_000;
const CATALOG_ARTIST_THUMBNAILS_MAX = 800;

function sumLastNDays(desc: Array<{ date: string; daily: number | null }>, days: number) {
  return desc.slice(0, days).reduce((acc, r) => acc + Number(r.daily ?? 0), 0);
}

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

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
  const n = Number(x ?? "90") || 90;
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
    console.error("Error fetching recent tracks metadata:", error);
    return [];
  }

  return (data ?? []) as TrackRow[];
}

async function fetchAllTracksMeta(
  sb: SupabaseClient,
  maxRows = 5000,
): Promise<TrackRow[]> {
  const pageSize = 1000;
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
      console.error("Error fetching tracks metadata:", error);
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
  const pageSize = 1000;
  const out: Array<{ date: string; streams_cumulative: number | null }> = [];
  let from = 0;
  const max = args.maxRows ?? 10000;

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
  searchParams?: Promise<{ artist_id?: string; isrc?: string; range?: string; view?: string }>;
}) {
  try {
    const sp = (await searchParams) ?? {};
    
    // Backwards-compat: old query-driven list view
    if ((sp.view ?? "").trim().toLowerCase() === "list") {
      redirect("/catalog/config");
    }

    const rangeDays = clampRangeDays(sp.range);
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

    let hideStaleAnnotations = false;
    try {
      const { data: uSettings } = await sb
        .from("user_settings")
        .select("hide_stale_override_annotations")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      hideStaleAnnotations = Boolean((uSettings as Record<string, unknown> | null)?.hide_stale_override_annotations);
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
      const maxId = Number((latestOverride as any)?.id ?? 0);
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
        3600,
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
        3600,
      );

      const defaultArtistId = Array.isArray((recent as any)?.spotify_artist_ids)
        ? String((recent as any).spotify_artist_ids?.[0] ?? "").trim()
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
        error: null as any,
      }),
      `catalog-artists-from-tracks-v2-${CATALOG_ARTIST_DROPDOWN_MAX_TRACKS}`,
      3600,
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
    3600,
  );

  if (tracksError) {
    console.error("Error fetching artist tracks:", tracksError);
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
    3600,
  );

  const latestRunDate = (latestRun as PlaylistDailyStatsRow | null)?.date ?? null;
  const startRunDate = latestRunDate ? addDays(latestRunDate, -rangeDays) : null;

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
    latestRunDate && startRunDate
      ? cachedQuery(
          async () =>
            await svc.rpc("catalog_artist_series", {
              artist_id: artistId,
              start_date: startRunDate,
              end_date: latestRunDate,
            }),
          `catalog-artist-series-${artistId}-${startRunDate}-${latestRunDate}-ov${overrideBuster}`,
          3600,
        )
      : Promise.resolve({ data: [] as any, error: null as any }),
    latestRunDate
      ? cachedQuery(
          async () =>
            await svc.rpc("catalog_artist_top_tracks_total", {
              artist_id: artistId,
              run_date: latestRunDate,
              limit_rows: 25,
            }),
          `catalog-artist-top-total-${artistId}-${latestRunDate}-ov${overrideBuster}`,
          3600,
        )
      : Promise.resolve({ data: [] as any, error: null as any }),
    latestRunDate
      ? cachedQuery(
          async () =>
            await svc.rpc("catalog_artist_top_tracks_daily", {
              artist_id: artistId,
              run_date: latestRunDate,
              limit_rows: 25,
            }),
          `catalog-artist-top-daily-${artistId}-${latestRunDate}-ov${overrideBuster}`,
          3600,
        )
      : Promise.resolve({ data: [] as any, error: null as any }),
  ]);

  const cumSeriesAscRun = ((seriesRows ?? []) as CatalogArtistSeriesRow[])
    .map((r) => ({ date: r.date, value: Number(r.streams_cumulative ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Keep dates as RUN dates in server payload; UI shifts to "data date" for display.
  const cumSeriesAsc = cumSeriesAscRun;

  const latestCum = cumSeriesAscRun.length ? cumSeriesAscRun[cumSeriesAscRun.length - 1].value : 0;

  const dailyArtistAscRun = cumSeriesAscRun.map((p, idx) => {
    if (idx === 0) return { date: p.date, daily: null };
    const prev = cumSeriesAscRun[idx - 1].value;
    return { date: p.date, daily: Math.max(0, p.value - prev) };
  });
  const dailyArtistDesc = [...dailyArtistAscRun].reverse();
  const dailyArtistWithMaDesc = computeDailyRollingAvg7(dailyArtistDesc);

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
      console.warn("Error fetching top-track artist metadata:", error);
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

  const topByCumulative = ((topTotalRows ?? []) as CatalogTopTrackRow[]).map((r) => {
    const meta = trackMetaByIsrc.get(r.isrc) ?? null;
    return {
      isrc: r.isrc,
      total: r.total ?? null,
      daily: null,
      name: r.name ?? null,
      albumImageUrl: r.album_image_url ?? null,
      artistNames: meta?.spotify_artist_names ?? null,
      artistIds: meta?.spotify_artist_ids ?? null,
      releaseDate: (meta?.release_date ?? "").trim() || null,
    };
  });

  const topByDaily = ((topDailyRows ?? []) as CatalogTopTrackRow[]).map((r) => {
    const meta = trackMetaByIsrc.get(r.isrc) ?? null;
    return {
      isrc: r.isrc,
      daily: r.daily ?? null,
      total: r.total ?? null,
      name: r.name ?? null,
      albumImageUrl: r.album_image_url ?? null,
      artistNames: meta?.spotify_artist_names ?? null,
      artistIds: meta?.spotify_artist_ids ?? null,
      releaseDate: (meta?.release_date ?? "").trim() || null,
    };
  });

  // Selected track panels (optional)
  const trackSeries =
    isrc && latestRunDate && startRunDate
      ? await fetchAllTrackSeries(svc, { isrc, startDate: startRunDate, endDate: latestRunDate, maxRows: 5000 })
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
            3600,
          )
        ).data
      : [];

  const trackOverrideAnnotationsDataDate = ((trackOverrideAnnotations ?? []) as TrackOverrideRow[])
    .filter((r) => !!r?.date)
    .map((r) => ({
      date: dataDateFromRunDate(r.date),
      note: (r.note ?? "").trim() || `Manual override (ISRC: ${isrc})`,
    }));

  const trackCumDesc = (trackSeries ?? []).map((r) => ({
    date: r.date,
    value: Number(r.streams_cumulative ?? 0),
  }));
  // Compute daily deltas based on RUN ordering but display DATA dates.
  const trackCumDescRun = (trackSeries ?? []).map((r) => ({
    date: r.date,
    value: Number(r.streams_cumulative ?? 0),
  }));
  const trackCumAscRun = [...trackCumDescRun].reverse();
  const trackDailyAsc = trackCumAscRun.map((p, idx) => {
    if (idx === 0) return { date: p.date, daily: null };
    const prev = trackCumAscRun[idx - 1].value;
    return { date: p.date, daily: Math.max(0, p.value - prev) };
  });
  const trackDailyDesc = [...trackDailyAsc]
    .reverse()
    .map((p) => ({ ...p }));
  const trackDailyWithMaDesc = computeDailyRollingAvg7(trackDailyDesc);
  const track24h = trackDailyDesc[0]?.daily ?? 0;
  const track7d = sumLastNDays(trackDailyDesc, 7);
  const track28d = sumLastNDays(trackDailyDesc, 28);
  const track30d = sumLastNDays(trackDailyDesc, 30);

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

    const rowsAll: TrackOverrideRowWithIsrc[] = [];
    const chunks = chunk(isrcs, 200);
    for (let i = 0; i < chunks.length; i++) {
      const isrcChunk = chunks[i] ?? [];
      if (!isrcChunk.length) continue;

      const { data: rowsRaw } = await cachedQuery(
        async () => {
          let q = svc
            .from("track_daily_stream_overrides")
            .select("date,isrc,note")
            .in("isrc", isrcChunk)
            .gte("date", startRunDate)
            .lte("date", latestRunDate);
          if (hideStaleAnnotations) q = q.not("note", "like", "stale-fix:%");
          return await q.order("date", { ascending: false }).limit(500);
        },
        `catalog-artist-overrides-${artistId}-${startRunDate}-${latestRunDate}-c${i}-ov${overrideBuster}-stale${hideStaleAnnotations ? "1" : "0"}`,
        3600,
      );

      rowsAll.push(...(((rowsRaw ?? []) as TrackOverrideRowWithIsrc[]) ?? []));
    }

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
      3600,
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
          .limit(5000),
      `catalog-track-playlist-memberships-v1-${isrc}-${latestRunDate}`,
      3600,
    );

    if (membershipErr) {
      console.warn("Error fetching track playlist memberships:", membershipErr);
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

    // Fetch playlist metadata (no caching: keeps type badges in sync with /playlists/config edits).
    // Also provide a fallback if `playlist_type`/`display_order` columns don't exist yet.
    let playlistMetaRows: unknown[] = [];
    try {
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
        const fallback = await svc
          .from("playlists")
          .select("playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url")
          .in("playlist_key", playlistKeys);

        if (fallback.error) {
          console.warn("Error fetching playlist metadata (fallback):", fallback.error);
        } else {
          playlistMetaRows = (fallback.data ?? []) as unknown[];
        }
      } else if (res.error) {
        console.warn("Error fetching playlist metadata:", res.error);
      } else {
        playlistMetaRows = (res.data ?? []) as unknown[];
      }
    } catch (e) {
      console.warn("Error fetching playlist metadata:", e);
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
    console.error("Error in CatalogPage:", error);
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
