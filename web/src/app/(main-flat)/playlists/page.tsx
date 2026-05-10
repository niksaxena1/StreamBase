import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { List, ExternalLink, Music } from "lucide-react";
import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { formatDateISO } from "@/lib/format";
import { PlaylistDashboardControls } from "@/components/dashboard/PlaylistDashboardControls";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { supabaseService } from "@/lib/supabase/service";
import { PlaylistPageClient } from "./PlaylistPageClient";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { PlaylistTracksSection } from "./PlaylistTracksSection";
import { PageHeader } from "@/components/shell/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { PlaylistHistory30dDetails, type PlaylistHistoryRow } from "./PlaylistHistory30dDetails";
import { PlaylistHeaderSelects } from "./PlaylistGranularitySelect";
import { PlaylistMembershipStats } from "@/components/dashboard/PlaylistMembershipStats";
import { DocumentTitle } from "@/components/shell/DocumentTitle";

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playlists",
};

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
  track_count?: number | null;
};

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
  missing_streams_track_count?: number | null;
  source_run_id?: string | null;
};

type TrackOverrideRow = {
  date: string;
  isrc: string;
  note: string | null;
};

type TrackMetaRow = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
};

type PlaylistMembershipRow = {
  playlist_key: string;
  isrc: string;
  valid_from: string;
  valid_to: string | null;
};

type ManualOverrideAnnotation = {
  date: string;
  note: string;
  title?: string;
  imageUrl?: string | null;
};

function clampRangeDays(x: unknown) {
  const n = Number(x ?? "30") || 30;
  return Math.max(7, Math.min(365, n));
}

function isIsoDateInRange(args: { d: string; start: string; end: string }) {
  // ISO date format YYYY-MM-DD can be compared lexicographically.
  return args.d >= args.start && args.d <= args.end;
}

function isMembershipActiveAtDate(m: PlaylistMembershipRow, runDate: string) {
  if (!m.valid_from) return false;
  if (m.valid_from > runDate) return false;
  if (m.valid_to && m.valid_to < runDate) return false;
  return true;
}


export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams?: Promise<{ playlist_key?: string; range?: string; view?: string; start?: string; end?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const playlistKey = (sp.playlist_key ?? "").trim();
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

  // IMPORTANT: Core analytics tables are admin-only via RLS. Using a request-scoped
  // Supabase client inside Next's cache revalidation can drop cookies, causing
  // revalidation to fail and stale cached data to persist. Use the service role
  // client for cached reads; access is still gated above.
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
  // removals of overrides invalidate stale playlist stats caches.
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
    // ignore
  }

  // Backwards-compat: old query-driven list view
  if ((sp.view ?? "").trim().toLowerCase() === "list") {
    redirect("/playlists/config");
  }

  // Default view: dashboard (if missing playlist_key, auto-open remembered/default)
  if (!playlistKey) {
    return (
      <RememberParamRedirect
        param="playlist_key"
        storageKey="sb:last_playlist_key"
        defaultValue="all_catalog"
        loadingTitle="Opening your last playlist…"
        loadingSubtitle="If this is your first time, we’ll start with All Catalog."
      />
    );
  }

  // Global time-rollback: if active, cap all queries at this date.
  const rollbackDate = await getRollbackDate();
  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;

  // Dashboard view - show analytics for selected playlist (cached for 1 hour)
  const [
    { data: playlists },
    { data: latest },
    { data: prev },
    { data: history },
  ] = await Promise.all([
    cachedQuery(
      async () =>
        await svc
          .from("playlists")
          .select("playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url")
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("display_name", { ascending: true }),
      "playlists-list",
      3600,
    ),
    cachedQuery(
      async () => {
        let q = svc
          .from("playlist_daily_stats")
          .select(
            "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net,source_run_id",
          )
          .eq("playlist_key", playlistKey);
        if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
        return await q
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
      },
      `playlist-latest-v2-${playlistKey}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`,
      3600,
    ),
    cachedQuery(
      async () => {
        let q = svc
          .from("playlist_daily_stats")
          .select("date")
          .eq("playlist_key", playlistKey);
        if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
        return await q
          .order("date", { ascending: false })
          .range(1, 1)
          .maybeSingle();
      },
      `playlist-prev-v2-${playlistKey}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`,
      3600,
    ),
    cachedQuery(
      async () => {
        let q = svc
          .from("playlist_daily_stats")
          .select(
            "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net,missing_streams_track_count",
          )
          .eq("playlist_key", playlistKey);
        if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
        return await q
          .order("date", { ascending: false })
          .limit(rangeDays);
      },
      `playlist-history-v2-${playlistKey}-${rangeDays}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`,
      3600,
    ),
  ]);

  // Fetch latest stats for all playlists in a single query (replaces N+1 pattern).
  const { data: allPlaylistsLatestStats } = await cachedQuery(
    async () => {
      const playlistKeys = (playlists ?? []).map((p: any) => p.playlist_key);
      if (playlistKeys.length === 0) return { data: [], error: null };

      return await svc.rpc("playlists_latest_track_counts", {
        p_keys: playlistKeys,
      });
    },
    "playlists-all-latest-stats-v3",
    3600,
  );

  const statsMap = new Map(
    (allPlaylistsLatestStats ?? []).map((stat: any) => [stat.playlist_key, stat.track_count])
  );

  const playlistOptions = (playlists ?? []).map((p) => ({
    ...p,
    spotify_playlist_image_url: p.spotify_playlist_image_url,
    track_count: statsMap.get(p.playlist_key) ?? null,
  })) as PlaylistRow[];
  const currentPlaylist = playlistOptions.find((p) => p.playlist_key === playlistKey);
  const title = currentPlaylist?.display_name ?? playlistKey;
  const playlistImageUrl = currentPlaylist?.spotify_playlist_image_url ?? null;
  const spotifyPlaylistId = currentPlaylist?.spotify_playlist_id ?? null;
  const spotifyUrl = spotifyPlaylistId
    ? `https://open.spotify.com/playlist/${spotifyPlaylistId}`
    : null;

  const latestDate = (latest as PlaylistDailyStatsRow | null)?.date ?? null;
  const latestSourceRunId = (latest as PlaylistDailyStatsRow | null)?.source_run_id ?? null;
  const prevDate = (prev as { date: string } | null)?.date ?? null;

  const { data: playlistArtistCountRaw } = await cachedQuery(
    async () => {
      if (!latestDate) return { data: null, error: null };
      return await svc.rpc("playlist_distinct_artist_count", {
        playlist_key: playlistKey,
        run_date: latestDate,
      });
    },
    `playlist-distinct-artist-count-v1-${playlistKey}-${latestDate}-rb${rollbackDate ?? "live"}`,
    3600,
  );

  function parseRpcBigint(v: unknown): number | null {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    return null;
  }

  const playlistArtistCount = parseRpcBigint(playlistArtistCountRaw);

  const playlistTrackCountDisplay =
    (latest as PlaylistDailyStatsRow | null)?.track_count ??
    statsMap.get(playlistKey) ??
    null;

  const hist = (history ?? []) as PlaylistDailyStatsRow[];

  // Manual stream override annotations for charts (run-date scoped; UI shows data-date).
  const overrideAnnotations: ManualOverrideAnnotation[] = await (async () => {
    if (!hist.length) return [];
    const endRunDate = (hist[0]?.date ?? "").trim();
    const startRunDate = (hist[hist.length - 1]?.date ?? "").trim();
    if (!startRunDate || !endRunDate) return [];

    const { data: overrideRowsRaw } = await cachedQuery(
      async () => {
        let q = svc
          .from("track_daily_stream_overrides")
          .select("date,isrc,note")
          .gte("date", startRunDate)
          .lte("date", endRunDate);
        if (hideStaleAnnotations) q = q.not("note", "like", "stale-fix:%");
        return await q.order("date", { ascending: false }).limit(500);
      },
      `playlist-overrides-range-${startRunDate}-${endRunDate}-stale${hideStaleAnnotations ? "1" : "0"}`,
      3600,
    );

    const overrideRows = (overrideRowsRaw ?? []) as TrackOverrideRow[];
    const isrcs = Array.from(
      new Set(overrideRows.map((r) => (r?.isrc ?? "").trim()).filter(Boolean)),
    );
    if (!isrcs.length) return [];

    const { data: trackMetaRaw } = await cachedQuery(
      async () =>
        await svc
          .from("tracks")
          .select("isrc,name,spotify_album_image_url,spotify_artist_names")
          .in("isrc", isrcs)
          .limit(2000),
      `playlist-overrides-track-meta-v2-${[...isrcs].sort().join(",")}`,
      3600,
    );
    const trackMeta = (trackMetaRaw ?? []) as TrackMetaRow[];
    const metaByIsrc = new Map<string, TrackMetaRow>();
    for (const m of trackMeta) {
      const key = (m?.isrc ?? "").trim();
      if (!key) continue;
      if (!metaByIsrc.has(key)) metaByIsrc.set(key, m);
    }

    const membershipPlaylistKeys =
      playlistKey === "all_catalog" ? (["releases", "ext"] as const) : ([playlistKey] as const);

    const { data: membershipRowsRaw } = await cachedQuery(
      async () =>
        await svc
          .from("playlist_memberships")
          .select("playlist_key,isrc,valid_from,valid_to")
          .in("playlist_key", [...membershipPlaylistKeys])
          .in("isrc", isrcs)
          .lte("valid_from", endRunDate)
          .or(`valid_to.is.null,valid_to.gte.${startRunDate}`)
          .limit(5000),
      `playlist-memberships-for-overrides-${playlistKey}-${startRunDate}-${endRunDate}-${isrcs.length}`,
      3600,
    );

    const membershipRows = (membershipRowsRaw ?? []) as PlaylistMembershipRow[];
    const membershipsByIsrc = new Map<string, PlaylistMembershipRow[]>();
    for (const m of membershipRows) {
      const key = (m?.isrc ?? "").trim();
      if (!key) continue;
      const arr = membershipsByIsrc.get(key) ?? [];
      arr.push(m);
      membershipsByIsrc.set(key, arr);
    }

    const out: ManualOverrideAnnotation[] = [];
    for (const o of overrideRows) {
      const d = (o?.date ?? "").trim();
      const isrc = (o?.isrc ?? "").trim();
      if (!d || !isrc) continue;
      if (!isIsoDateInRange({ d, start: startRunDate, end: endRunDate })) continue;

      const memberships = membershipsByIsrc.get(isrc) ?? [];
      const isActive = memberships.some((m) => isMembershipActiveAtDate(m, d));
      if (!isActive) continue;

      const meta = metaByIsrc.get(isrc) ?? null;
      const artist = meta?.spotify_artist_names?.[0] ?? null;
      const trackName = meta?.name ?? null;
      const title =
        artist && trackName
          ? `${artist} - ${trackName}`
          : trackName
          ? trackName
          : artist
          ? artist
          : isrc;

      out.push({
        date: dataDateFromRunDate(d),
        title,
        imageUrl: meta?.spotify_album_image_url ?? null,
        note: (o.note ?? "").trim() || `Manual override (ISRC: ${isrc})`,
      });
    }

    return out;
  })();

  // Removed count is displayed in the metrics panel; we cap at 500 (same as UI table).
  const { data: removedRows } = await cachedQuery(
    async () =>
      await svc.rpc("playlist_removed_tracks", {
        playlist_key: playlistKey,
        limit_rows: 500,
      }),
    `playlist-removed-rows-v2-${playlistKey}-${latestDate ?? "none"}-${latestSourceRunId ?? "none"}`,
    86400,
  );
  const removedTracksCount = Array.isArray(removedRows) ? removedRows.length : 0;

  const playlistTrackCountNumeric =
    playlistTrackCountDisplay != null ? Number(playlistTrackCountDisplay) : null;

  return (
    <div className="space-y-4">
      <DocumentTitle title={title} />
      <PageHeader
        icon={
          playlistKey === "all_catalog" ? (
            <div
              className="sb-ring flex h-12 w-12 items-center justify-center rounded-lg"
              style={{ background: "var(--sb-accent)" }}
            >
              <Music className="h-6 w-6" style={{ color: "black" }} />
            </div>
          ) : playlistImageUrl ? (
            <Image
              src={playlistImageUrl}
              alt="Playlist cover"
              width={48}
              height={48}
              className="rounded-lg object-cover sb-ring opacity-100"
            />
          ) : (
            <div className="h-12 w-12 rounded-lg sb-ring bg-white/60" />
          )
        }
        title={
          <div className="flex items-center gap-2">
            <span>{title}</span>
            {spotifyUrl && (
              <Link
                href={spotifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                title="Open on Spotify"
                style={{ color: "var(--sb-muted)" }}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
          </div>
        }
        subtitle={
          latestDate ? (
            <>
              Latest data date:{" "}
              <span className="font-mono">{formatDateISO(dataDateFromRunDate(latestDate))}</span>
            </>
          ) : (
            "No stats found for this playlist yet."
          )
        }
        actions={
          <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PlaylistHeaderSelects
                rangeDays={rangeDays}
                latestDataDate={latestDate ? dataDateFromRunDate(latestDate) : null}
              />
              <Link
                href="/playlists/config"
                className="sb-ring grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
                aria-label="Playlist config"
                title="Playlist config"
              >
                <List className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
              </Link>
            </div>
            <PlaylistMembershipStats
              trackCount={playlistTrackCountNumeric}
              artistCount={playlistArtistCount}
              className="ml-auto shrink-0 lg:hidden"
            />
          </div>
        }
      />

        <PlaylistDashboardControls
          playlists={playlistOptions}
          playlistKey={playlistKey}
          trackCount={playlistTrackCountNumeric}
          artistCount={playlistArtistCount}
        />

        <PlaylistPageClient
          latest={latest as PlaylistDailyStatsRow | null}
          latestDate={latestDate}
          rangeDays={rangeDays}
          history={hist}
          removedTracksCount={removedTracksCount}
          playlistKey={playlistKey}
          overrideAnnotations={overrideAnnotations}
        />

        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="sb-card p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Skeleton className="h-8 w-8 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <Skeleton className="h-3 w-2/3" />
                        <Skeleton className="mt-1 h-3 w-1/3" />
                      </div>
                      <Skeleton className="h-3 w-10" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="sb-card p-4">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
        >
          <PlaylistTracksSection
            playlistKey={playlistKey}
            latestRunDate={latestDate}
            prevRunDate={prevDate}
            cacheBuster={latestSourceRunId}
          />
        </Suspense>

        <PlaylistHistory30dDetails rows={hist as unknown as PlaylistHistoryRow[]} />
    </div>
  );
}
