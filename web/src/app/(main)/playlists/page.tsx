import Link from "next/link";
import { Suspense } from "react";
import { List, ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { formatDateISO } from "@/lib/format";
import { PlaylistDashboardControls } from "@/components/dashboard/PlaylistDashboardControls";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { supabaseService } from "@/lib/supabase/service";
import { PlaylistPageClient } from "./PlaylistPageClient";
import { PlaylistHeaderWithSelector } from "./PlaylistHeaderWithSelector";
import { PlaylistMetricProvider } from "./PlaylistMetricContext";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { PlaylistTracksSection } from "./PlaylistTracksSection";

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
};

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
};

function clampRangeDays(x: unknown) {
  const n = Number(x ?? "90") || 90;
  return Math.max(7, Math.min(365, n));
}


export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams?: Promise<{ playlist_key?: string; range?: string; view?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const playlistKey = (sp.playlist_key ?? "").trim();
  const rangeDays = clampRangeDays(sp.range);

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
      async () =>
        await svc
          .from("playlist_daily_stats")
          .select("date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
          .eq("playlist_key", playlistKey)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      `playlist-latest-${playlistKey}`,
      3600,
    ),
    cachedQuery(
      async () =>
        await svc
          .from("playlist_daily_stats")
          .select("date")
          .eq("playlist_key", playlistKey)
          .order("date", { ascending: false })
          .range(1, 1)
          .maybeSingle(),
      `playlist-prev-${playlistKey}`,
      3600,
    ),
    cachedQuery(
      async () =>
        await svc
          .from("playlist_daily_stats")
          .select("date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
          .eq("playlist_key", playlistKey)
          .order("date", { ascending: false })
          .limit(rangeDays),
      `playlist-history-${playlistKey}-${rangeDays}`,
      3600,
    ),
  ]);

  const playlistOptions = (playlists ?? []).map((p) => ({
    ...p,
    spotify_playlist_image_url:
      p.playlist_key === "all_catalog"
        ? "/globe.svg" // Default image for All Catalog
        : p.spotify_playlist_image_url,
  })) as PlaylistRow[];
  const currentPlaylist = playlistOptions.find((p) => p.playlist_key === playlistKey);
  const title = currentPlaylist?.display_name ?? playlistKey;
  const playlistImageUrl = currentPlaylist?.spotify_playlist_image_url ?? null;
  const spotifyPlaylistId = currentPlaylist?.spotify_playlist_id ?? null;
  const spotifyUrl = spotifyPlaylistId
    ? `https://open.spotify.com/playlist/${spotifyPlaylistId}`
    : null;

  const latestDate = (latest as PlaylistDailyStatsRow | null)?.date ?? null;
  const prevDate = (prev as { date: string } | null)?.date ?? null;

  const hist = (history ?? []) as PlaylistDailyStatsRow[];

  // Removed count is displayed in the metrics panel; we cap at 500 (same as UI table).
  const { data: removedRows } = await cachedQuery(
    async () =>
      await svc.rpc("playlist_removed_tracks", {
        playlist_key: playlistKey,
        limit_rows: 500,
      }),
    `playlist-removed-rows-v1-${playlistKey}-${latestDate ?? "none"}`,
    86400,
  );
  const removedTracksCount = Array.isArray(removedRows) ? removedRows.length : 0;

  return (
    <PlaylistMetricProvider>
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            {playlistImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={playlistImageUrl}
                alt="Playlist cover"
                className="h-12 w-12 rounded-lg object-cover sb-ring"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg sb-ring bg-white/60" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {title}
                </h1>
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
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                {latestDate ? (
                  <>
                    Latest data date: <span className="font-mono">{formatDateISO(dataDateFromRunDate(latestDate))}</span>
                  </>
                ) : (
                  "No stats found for this playlist yet."
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PlaylistHeaderWithSelector />
            <Link
              href="/playlists/config"
              className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
              aria-label="Playlist config"
              title="Playlist config"
            >
              <List className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
            </Link>
          </div>
        </div>

        <PlaylistDashboardControls
          playlists={playlistOptions}
          playlistKey={playlistKey}
          rangeDays={rangeDays}
        />

        <PlaylistPageClient
          latest={latest as PlaylistDailyStatsRow | null}
          latestDate={latestDate}
          rangeDays={rangeDays}
          history={hist}
          removedTracksCount={removedTracksCount}
          playlistKey={playlistKey}
        />

        <Suspense
          fallback={
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border p-4 text-sm opacity-70" style={{ borderColor: "var(--sb-border)" }}>
                Loading playlist tracks…
              </div>
              <div className="rounded-2xl border p-4 text-sm opacity-70" style={{ borderColor: "var(--sb-border)" }}>
                Loading recent changes…
              </div>
            </div>
          }
        >
          <PlaylistTracksSection playlistKey={playlistKey} latestRunDate={latestDate} prevRunDate={prevDate} />
        </Suspense>
      </div>
    </PlaylistMetricProvider>
  );
}
