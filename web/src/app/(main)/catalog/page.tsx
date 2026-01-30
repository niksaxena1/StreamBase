import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, User } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { formatInt, formatDateISO } from "@/lib/format";
import { getArtists } from "@/lib/spotify";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { ArtistDashboardControls } from "@/components/dashboard/ArtistDashboardControls";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { StatCard } from "@/components/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CatalogPageClient } from "./CatalogPageClient";
import { dataDateFromRunDate } from "@/lib/sotDates";

const STREAM_PAYOUT_USD = 0.002;

function computeRollingAvg7(desc: Array<{ date: string; daily: number }>) {
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; daily: number; ma7: number | null }> = [];

  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.daily ?? 0));
    // Always compute average if we have at least 1 data point, but prefer 7+ for accuracy
    const avg = window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : null;
    outAsc.push({ date: asc[i].date, daily: asc[i].daily, ma7: avg });
  }

  return outAsc.reverse();
}

function sumLastNDays(desc: Array<{ date: string; daily: number }>, days: number) {
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
};

type TrackDailyRow = {
  date: string;
  isrc: string;
  streams_cumulative: number | null;
};

type PlaylistDailyStatsRow = { date: string };

function clampRangeDays(x: unknown) {
  const n = Number(x ?? "90") || 90;
  return Math.max(7, Math.min(365, n));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

async function fetchAllTrackDaily(
  sb: SupabaseClient,
  args: { isrcs: string[]; startDate: string; endDate: string; maxRows?: number },
): Promise<TrackDailyRow[]> {
  const pageSize = 1000;
  const out: TrackDailyRow[] = [];
  let from = 0;
  const max = args.maxRows ?? 200000;

  while (from < max) {
    const to = from + pageSize - 1;
    const { data } = await sb
      .from("track_daily_streams")
      .select("date,isrc,streams_cumulative")
      .in("isrc", args.isrcs)
      .gte("date", args.startDate)
      .lte("date", args.endDate)
      .order("date", { ascending: false })
      .range(from, to);

    const rows = (data ?? []) as TrackDailyRow[];
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
      .from("track_daily_streams")
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

    // We don't have an artists table; derive from track metadata.
    const trackMetaRows = await fetchAllTracksMeta(svc, 5000);
    const artists = deriveArtists(trackMetaRows);
    const firstArtistId = artists[0]?.id ?? null;

    const artistId = (sp.artist_id ?? "").trim();
    if (!artistId) {
      return (
        <RememberParamRedirect
          param="artist_id"
          storageKey="sb:last_artist_id"
          defaultValue={firstArtistId}
          loadingTitle="Opening your last artist…"
          loadingSubtitle="If this is your first time, we'll pick the first artist we find."
        />
      );
    }

  // Track list for this artist (cached for 1 hour)
  const { data: tracks, error: tracksError } = await cachedQuery(
    async () =>
      await svc
        .from("tracks")
        .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url")
        .contains("spotify_artist_ids", [artistId])
        .order("last_seen", { ascending: false })
        .limit(800),
    `artist-tracks-v2-${artistId}`,
    3600,
  );

  if (tracksError) {
    console.error("Error fetching artist tracks:", tracksError);
    // Return error state instead of crashing
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Error loading artist data: {tracksError.message}
        </div>
      </div>
    );
  }

  const artistTracks = (tracks ?? []) as TrackRow[];
  const isrcs = artistTracks.map((t) => t.isrc);

  const artistName =
    artists.find((a) => a.id === artistId)?.name ??
    artistNameFor(artistTracks, artistId) ??
    artistId;

  // Canonical latest RUN date (DB snapshot date) - cached
  const { data: latestRun } = await cachedQuery(
    async () =>
      await svc
        .from("playlist_daily_stats")
        .select("date")
        .eq("playlist_key", "all_catalog")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    "latest-date-all-catalog",
    3600,
  );

  const latestRunDate = (latestRun as PlaylistDailyStatsRow | null)?.date ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const startRunDate = latestRunDate ? addDays(latestRunDate, -rangeDays) : null;

  const isrc = (sp.isrc ?? "").trim() || null;

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

  // Pull per-track cumulative series for the whole artist (best-effort; chunk to keep URL sizes sane)
  const dailyRows: TrackDailyRow[] = [];
  if (isrcs.length && latestRunDate && startRunDate) {
    await Promise.all(
      chunk(isrcs, 120).map(async (isrcChunk) => {
        const rows = await fetchAllTrackDaily(svc, {
          isrcs: isrcChunk,
          startDate: startRunDate,
          endDate: latestRunDate,
          maxRows: 200000,
        });
        dailyRows.push(...rows);
      }),
    );
  }

  // Aggregate cumulative by date (sum streams_cumulative across tracks)
  const cumByDate = new Map<string, number>();
  const byIsrcByDate = new Map<string, Map<string, number>>();

  for (const r of dailyRows) {
    const v = Number(r.streams_cumulative ?? 0);
    cumByDate.set(r.date, (cumByDate.get(r.date) ?? 0) + v);

    let perIsrc = byIsrcByDate.get(r.isrc);
    if (!perIsrc) {
      perIsrc = new Map();
      byIsrcByDate.set(r.isrc, perIsrc);
    }
    perIsrc.set(r.date, v);
  }

  const cumSeriesAscRun = Array.from(cumByDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const cumSeriesAsc = cumSeriesAscRun.map((p) => ({ ...p, date: dataDateFromRunDate(p.date) }));

  const latestCum = cumSeriesAscRun.length ? cumSeriesAscRun[cumSeriesAscRun.length - 1].value : 0;
  const prevCum = cumSeriesAscRun.length > 1 ? cumSeriesAscRun[cumSeriesAscRun.length - 2].value : 0;

  const dailyArtistAscRun = cumSeriesAscRun.map((p, idx) => {
    if (idx === 0) return { date: p.date, daily: 0 };
    const prev = cumSeriesAscRun[idx - 1].value;
    return { date: p.date, daily: Math.max(0, p.value - prev) };
  });
  const dailyArtistAsc = dailyArtistAscRun.map((p) => ({ ...p, date: dataDateFromRunDate(p.date) }));
  const dailyArtistDesc = [...dailyArtistAsc].reverse();
  const dailyArtistWithMaDesc = computeRollingAvg7(dailyArtistDesc);

  const artist24h = dailyArtistDesc[0]?.daily ?? 0;
  const artist7d = sumLastNDays(dailyArtistDesc, 7);
  const artist28d = sumLastNDays(dailyArtistDesc, 28);
  const artist30d = sumLastNDays(dailyArtistDesc, 30);

  // Per-track latest and daily deltas (for top lists)
  const latestByIsrc = new Map<string, number>();
  const prevByIsrc = new Map<string, number>();
  if (latestRunDate) {
    for (const [isrcKey, perDate] of byIsrcByDate.entries()) {
      const latestV = perDate.get(latestRunDate);
      if (latestV !== undefined) latestByIsrc.set(isrcKey, latestV);
      // Use previous calendar day; if missing, it's ok (daily becomes null)
      const prevDay = addDays(latestRunDate, -1);
      const prevV = perDate.get(prevDay);
      if (prevV !== undefined) prevByIsrc.set(isrcKey, prevV);
    }
  }

  const topByCumulative = isrcs
    .map((id) => ({
      isrc: id,
      total: latestByIsrc.get(id) ?? null,
      daily: null,
      name: artistTracks.find((t) => t.isrc === id)?.name ?? null,
      albumImageUrl: artistTracks.find((t) => t.isrc === id)?.spotify_album_image_url ?? null,
    }))
    .filter((r) => r.total !== null)
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, 25);

  const topByDaily = isrcs
    .map((id) => {
      const latestV = latestByIsrc.get(id);
      const prevV = prevByIsrc.get(id);
      const daily = latestV !== undefined && prevV !== undefined ? Math.max(0, latestV - prevV) : null;
      return {
        isrc: id,
        daily,
        total: latestV ?? null,
        name: artistTracks.find((t) => t.isrc === id)?.name ?? null,
        albumImageUrl: artistTracks.find((t) => t.isrc === id)?.spotify_album_image_url ?? null,
      };
    })
    .filter((r) => r.daily !== null)
    .sort((a, b) => Number(b.daily) - Number(a.daily))
    .slice(0, 25);

  // Selected track panels (optional)
  const trackSeries =
    isrc && latestRunDate && startRunDate
      ? await fetchAllTrackSeries(svc, { isrc, startDate: startRunDate, endDate: latestRunDate, maxRows: 5000 })
      : ([] as Array<{ date: string; streams_cumulative: number | null }>);

  const trackCumDesc = (trackSeries ?? []).map((r) => ({
    date: dataDateFromRunDate(r.date),
    value: Number(r.streams_cumulative ?? 0),
  }));
  // Compute daily deltas based on RUN ordering but display DATA dates.
  const trackCumDescRun = (trackSeries ?? []).map((r) => ({
    date: r.date,
    value: Number(r.streams_cumulative ?? 0),
  }));
  const trackCumAscRun = [...trackCumDescRun].reverse();
  const trackDailyAsc = trackCumAscRun.map((p, idx) => {
    if (idx === 0) return { date: p.date, daily: 0 };
    const prev = trackCumAscRun[idx - 1].value;
    return { date: p.date, daily: Math.max(0, p.value - prev) };
  });
  const trackDailyDesc = [...trackDailyAsc]
    .reverse()
    .map((p) => ({ ...p, date: dataDateFromRunDate(p.date) }));
  const trackDailyWithMaDesc = computeRollingAvg7(trackDailyDesc);
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

  // Fetch artist images from Spotify API
  const artistIds = artists.map((a) => a.id);
  const artistDataMap = await getArtists(artistIds);
  const artistsWithImages = artists.map((artist) => {
    const artistData = artistDataMap.get(artist.id);
    return {
      ...artist,
      imageUrl: artistData?.imageUrl ?? null,
    };
  });

  // Fetch selected track details if isrc is available
  let selectedTrack: { 
    name: string | null; 
    albumImageUrl: string | null; 
    spotifyTrackId: string | null;
    artistNames: string[] | null;
    artistIds: string[] | null;
  } | null = null;
  if (isrc) {
    const { data: trackData } = await cachedQuery(
      async () =>
        await svc
          .from("tracks")
          .select("name,spotify_album_image_url,spotify_track_id,spotify_artist_names,spotify_artist_ids")
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
      };
      selectedTrack = {
        name: track.name ?? null,
        albumImageUrl: track.spotify_album_image_url ?? null,
        spotifyTrackId: track.spotify_track_id ?? null,
        artistNames: track.spotify_artist_names ?? null,
        artistIds: track.spotify_artist_ids ?? null,
      };
    }
  }

  return (
    <div className="space-y-4">
      <CatalogPageClient
        latestCum={latestCum}
        latestDate={latestDataDate}
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
        artistImageUrl={artistsWithImages.find((a) => a.id === artistId)?.imageUrl ?? null}
        topByCumulative={topByCumulative}
        topByDaily={topByDaily}
        selectedTrack={selectedTrack}
        trackCumDesc={trackCumDesc}
        trackDailyWithMaDesc={trackDailyWithMaDesc}
        track24h={track24h}
        track7d={track7d}
        track28d={track28d}
        track30d={track30d}
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
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          <h2 className="font-semibold">Error loading catalog page</h2>
          <p className="mt-1">{errorMessage}</p>
        </div>
      </div>
    );
  }
}
