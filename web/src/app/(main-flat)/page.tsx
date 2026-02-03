import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { SOT_DATA_LAG_DAYS, addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { HomeDashboardClient } from "./HomeDashboardClient";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

type TrackSnapshotRow = {
  isrc: string;
  streams_cumulative: number | null;
};

type TrackMetaRow = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_artist_ids: string[] | null;
};

type TrackOverrideRow = {
  date: string;
  isrc: string;
  note: string | null;
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

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
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

function isIsoDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function sanitizeIsoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!isIsoDateString(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

async function fetchAllTrackSnapshotsForDate(
  svc: ReturnType<typeof supabaseService>,
  args: { date: string; maxRows?: number },
) {
  // Supabase/PostgREST commonly caps responses at 1000 rows -> page explicitly.
  const pageSize = 1000;
  const hardCap = args.maxRows ?? 25_000;
  const out: TrackSnapshotRow[] = [];

  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await svc
      .from("track_daily_streams_effective_public")
      .select("isrc,streams_cumulative")
      .eq("date", args.date)
      .order("streams_cumulative", { ascending: false })
      .range(from, to);

    if (error) throw error;
    const rows = (data ?? []) as TrackSnapshotRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

async function fetchTrackMetaByIsrc(
  svc: ReturnType<typeof supabaseService>,
  isrcs: string[],
) {
  if (!isrcs.length) return new Map<string, TrackMetaRow>();

  // Keep IN() batches reasonably small to avoid URL length issues.
  const batchSize = 250;
  const out = new Map<string, TrackMetaRow>();
  for (let i = 0; i < isrcs.length; i += batchSize) {
    const batch = isrcs.slice(i, i + batchSize);
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,name,release_date,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
      .in("isrc", batch);
    if (error) throw error;
    for (const r of (data ?? []) as TrackMetaRow[]) out.set(r.isrc, r);
  }
  return out;
}

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string; range?: string; daily?: string; xy_date?: string }>;
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
          await cachedQuery<{ spotify_playlist_image_url: string | null }>(
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
  const latestRunDate = (latest as PlaylistDailyStatsRow | null)?.date ?? null;

  const title =
    playlistKey === "releases"
      ? "Releases"
      : playlistKey === "ext"
        ? "ext"
        : "All Catalog";

  // xy_date is a DATA date (not run date). Convert to run date for querying.
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const selectedDataDate = sanitizeIsoDate(sp.xy_date) ?? latestDataDate;
  const selectedRunDate = selectedDataDate
    ? addDaysISO(selectedDataDate, SOT_DATA_LAG_DAYS)
    : latestRunDate;

  // Bump cache key when scatter point shape changes.
  const scatterCacheKey = `home-track-scatter-v4-${selectedRunDate ?? "none"}`;
  const { data: trackScatterPoints, error: trackScatterErr } = await cachedQuery(
    async () => {
      if (!selectedRunDate) return { data: [] as any[], error: null as any };

      const prevRunDate = addDaysIso(selectedRunDate, -1);

      const [todayRows, prevRows] = await Promise.all([
        fetchAllTrackSnapshotsForDate(svc, { date: selectedRunDate, maxRows: 25_000 }),
        fetchAllTrackSnapshotsForDate(svc, { date: prevRunDate, maxRows: 25_000 }),
      ]);

      const prevByIsrc = new Map<string, number>();
      for (const r of prevRows) {
        if (!r?.isrc) continue;
        const n = Number(r.streams_cumulative ?? 0);
        if (!isFinite(n)) continue;
        prevByIsrc.set(r.isrc, n);
      }

      const isrcs = todayRows.map((r) => r.isrc).filter(Boolean);
      const metaByIsrc = await fetchTrackMetaByIsrc(svc, isrcs);

      const points = todayRows
        .map((r) => {
          const total = Number(r.streams_cumulative ?? 0);
          if (!isFinite(total)) return null;

          const prev = prevByIsrc.get(r.isrc);
          const hasPrev = prev !== undefined && isFinite(prev);
          const daily = hasPrev ? Math.max(0, total - (prev as number)) : 0;

          const meta = metaByIsrc.get(r.isrc) ?? null;
          return {
            isrc: r.isrc,
            name: meta?.name ?? null,
            release_date: meta?.release_date ?? null,
            artist_names: meta?.spotify_artist_names ?? null,
            artist_ids: meta?.spotify_artist_ids ?? null,
            album_image_url: meta?.spotify_album_image_url ?? null,
            total_streams_cumulative: total,
            daily_streams_delta: daily,
            has_prev_day: hasPrev,
          };
        })
        .filter(Boolean);

      return { data: points as any[], error: null as any };
    },
    scatterCacheKey,
    3600,
  );

  // Manual stream override annotations for charts (run-date scoped; UI shows data-date).
  // Keep logic consistent with `/playlists`.
  const overrideAnnotations: ManualOverrideAnnotation[] = await (async () => {
    const hist = ((history as PlaylistDailyStatsRow[] | null) ?? []) as PlaylistDailyStatsRow[];
    if (!hist.length) return [];
    const endRunDate = (hist[0]?.date ?? "").trim();
    const startRunDate = (hist[hist.length - 1]?.date ?? "").trim();
    if (!startRunDate || !endRunDate) return [];

    const { data: overrideRowsRaw } = await cachedQuery(
      async () =>
        await svc
          .from("track_daily_stream_overrides")
          .select("date,isrc,note")
          .gte("date", startRunDate)
          .lte("date", endRunDate)
          .order("date", { ascending: false })
          .limit(500),
      `home-overrides-range-${playlistKey}-${startRunDate}-${endRunDate}`,
      3600,
    );

    const overrideRows = (overrideRowsRaw ?? []) as TrackOverrideRow[];
    const isrcs = Array.from(
      new Set(overrideRows.map((r) => (r?.isrc ?? "").trim()).filter(Boolean)),
    );
    if (!isrcs.length) return [];

    const metaByIsrc = await fetchTrackMetaByIsrc(svc, isrcs);

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
      `home-memberships-for-overrides-${playlistKey}-${startRunDate}-${endRunDate}-${isrcs.length}`,
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
      trackScatterPoints={(trackScatterPoints as any[]) ?? []}
      trackScatterErrorMessage={trackScatterErr?.message ?? null}
      trackScatterDataDate={selectedDataDate}
      latestRunDate={latestRunDate}
      latestDataDate={latestDataDate}
      overrideAnnotations={overrideAnnotations}
    />
  );
}
