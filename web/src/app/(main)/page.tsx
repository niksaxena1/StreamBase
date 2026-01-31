import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { HomeDashboardClient } from "./HomeDashboardClient";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string; range?: string; daily?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const rangeDays = Math.max(7, Math.min(365, Number(sp.range ?? "30") || 30));

  const playlistKey: "all_catalog" | "releases" | "ext" =
    scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";

  const sb = await supabaseServer();
  const {
    data: { session },
  } = await sb.auth.getSession();

  // Middleware should already redirect, but keep a hard server-side guard
  // and avoid caching a sessionless response in production.
  if (!session) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  // IMPORTANT: playlist_daily_stats is protected by admin-only RLS. Use service client
  // for cached reads so cache revalidation can't fail due to missing cookies.
  const svc = supabaseService();

  const playlistImageUrl =
    playlistKey === "all_catalog"
      ? null
      : (
          await cachedQuery(
            async () =>
              await svc
                .from("playlists")
                .select("spotify_playlist_image_url")
                .eq("playlist_key", playlistKey)
                .maybeSingle(),
            `home-playlist-image-${playlistKey}`,
            3600,
          )
        ).data?.spotify_playlist_image_url ?? null;

  // Single query: fetch history and derive latest from first row (cached for 1 hour)
  const { data: history, error: historyErr } = await cachedQuery(
    async () =>
      await svc
        .from("playlist_daily_stats")
        .select(
          "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net",
        )
        .eq("playlist_key", playlistKey)
        .order("date", { ascending: false })
        .limit(rangeDays),
    `home-playlist-stats-${playlistKey}-${rangeDays}-${session.user.id}`,
    3600, // 1 hour
  );

  // Derive latest from first row of history (newest date)
  const latest = history && history.length > 0 ? history[0] : null;

  const title =
    playlistKey === "releases"
      ? "Releases"
      : playlistKey === "ext"
        ? "ext"
        : "All Catalog";

  return (
    <HomeDashboardClient
      sp={sp}
      playlistKey={playlistKey}
      title={title}
      rangeDays={rangeDays}
      latest={latest as PlaylistDailyStatsRow | null}
      history={(history as PlaylistDailyStatsRow[] | null) ?? []}
      playlistImageUrl={playlistImageUrl}
      historyErrorMessage={historyErr?.message ?? null}
    />
  );
}
