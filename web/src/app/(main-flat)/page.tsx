import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { SOT_DATA_LAG_DAYS, addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { HomeDashboardClient } from "./HomeDashboardClient";
import type { ArtistWeekendDipRow, TrackWeekendDipRow } from "./home/homeTypes";

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

/**
 * Fetch scatter-plot data via a single SQL function that joins today + yesterday
 * snapshots with track metadata in Postgres (replaces 3-step fetch of 50K+ rows).
 */
async function fetchTrackScatterPoints(
  svc: ReturnType<typeof supabaseService>,
  args: { runDate: string; prevDate: string },
) {
  // Supabase/PostgREST commonly applies a server-side max-rows cap (often 1000).
  // To avoid silently truncating the home scatter dataset, explicitly paginate
  // the RPC results using `.range()`.
  const pageSize = 1000;
  const hardCap = 100_000; // safety cap to avoid huge payloads on very large catalogs

  const out: any[] = [];
  const seenIsrc = new Set<string>();

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await svc
      .rpc("home_track_scatter_points", {
        p_run_date: args.runDate,
        p_prev_date: args.prevDate,
      })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as any[];
    if (!rows.length) break;

    for (const r of rows) {
      const isrc = String((r as any)?.isrc ?? "").trim();
      if (!isrc) continue;
      if (seenIsrc.has(isrc)) continue;
      seenIsrc.add(isrc);
      out.push(r);
    }

    // Last page (or server-side cap below our page size)
    if (rows.length < pageSize) break;
  }

  return out;
}

/** Fetch metadata for specific ISRCs (still needed for override annotations). */
async function fetchTrackMetaByIsrc(
  svc: ReturnType<typeof supabaseService>,
  isrcs: string[],
) {
  if (!isrcs.length) return new Map<string, TrackMetaRow>();

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

  let hideStaleAnnotations = false;
  try {
    const { data: uSettings } = await sb
      .from("user_settings")
      .select("hide_stale_override_annotations")
      .eq("user_id", session.user.id)
      .maybeSingle();
    hideStaleAnnotations = Boolean((uSettings as Record<string, unknown> | null)?.hide_stale_override_annotations);
  } catch {
    // graceful fallback
  }

  // Cache-buster: include count + max(id) in cache keys so both additions AND
  // removals of overrides invalidate stale playlist_daily_stats caches.
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

  // Global time-rollback: if active, cap all queries at this date.
  const rollbackDate = await getRollbackDate();
  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;

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
    async () => {
      let q = svc
        .from("playlist_daily_stats")
        .select(
          "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net",
        )
        .eq("playlist_key", playlistKey);
      if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
      return await q.order("date", { ascending: false }).limit(rangeDays + 7);
    },
    `home-playlist-stats-v2-${playlistKey}-${rangeDays + 7}-${session.user.id}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`,
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
  const scatterCacheKey = `home-track-scatter-v6-${selectedRunDate ?? "none"}`;
  const { data: trackScatterPoints, error: trackScatterErr } = await cachedQuery(
    async () => {
      if (!selectedRunDate) return { data: [] as any[], error: null as any };

      const prevRunDate = addDaysIso(selectedRunDate, -1);

      // Single SQL function replaces the old 3-step fetch of ~50K rows.
      const rows = await fetchTrackScatterPoints(svc, {
        runDate: selectedRunDate,
        prevDate: prevRunDate,
      });

      const points = rows
        .map((r: any) => {
          const total = Number(r.total_streams_cumulative ?? 0);
          if (!isFinite(total)) return null;
          return {
            isrc: r.isrc,
            name: r.name ?? null,
            release_date: r.release_date ?? null,
            artist_names: r.artist_names ?? null,
            artist_ids: r.artist_ids ?? null,
            album_image_url: r.album_image_url ?? null,
            total_streams_cumulative: total,
            daily_streams_delta: Number(r.daily_streams_delta ?? 0),
            has_prev_day: Boolean(r.has_prev_day),
            spotify_track_id: r.spotify_track_id ?? null,
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
      async () => {
        let q = svc
          .from("track_daily_stream_overrides")
          .select("date,isrc,note")
          .gte("date", startRunDate)
          .lte("date", endRunDate);
        if (hideStaleAnnotations) q = q.not("note", "like", "stale-fix:%");
        return await q.order("date", { ascending: false }).limit(500);
      },
      `home-overrides-range-${playlistKey}-${startRunDate}-${endRunDate}-stale${hideStaleAnnotations ? "1" : "0"}`,
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

  // Fetch artist weekend dips for the latest week
  const { data: artistWeekendDips } = await cachedQuery(
    async () => {
      return await svc.rpc("home_artist_weekend_dips", {
        p_min_weekday_avg: 0,
        p_anchor_data_date: latestDataDate ?? null,
      });
    },
    `home-artist-weekend-dips-${playlistKey}-${latestDataDate ?? "none"}-${session.user.id}`,
    3600, // 1 hour
  );

  // Fetch track weekend dips for the latest week
  const { data: trackWeekendDips } = await cachedQuery(
    async () => {
      return await svc.rpc("home_track_weekend_dips", {
        p_min_weekday_avg: 0,
        p_anchor_data_date: latestDataDate ?? null,
      });
    },
    `home-track-weekend-dips-${playlistKey}-${latestDataDate ?? "none"}-${session.user.id}`,
    3600, // 1 hour
  );

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
      artistWeekendDips={(artistWeekendDips as ArtistWeekendDipRow[] | null) ?? []}
      trackWeekendDips={(trackWeekendDips as TrackWeekendDipRow[] | null) ?? []}
    />
  );
}
