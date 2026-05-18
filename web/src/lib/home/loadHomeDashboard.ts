import type { SupabaseClient } from "@supabase/supabase-js";

import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { normalizeReleaseDateFromRpc } from "@/components/charts/trackReleaseCohorts";
import type {
  ArtistWeekendDipRow,
  HomeDashboardSearchParams,
  HomeDashboardServerProps,
  ManualOverrideAnnotation,
  NegativeDailyStreamsRow,
  ArtificialStreamSpikeRow,
  PlaylistDailyStatsRow,
  TrackWeekendDipRow,
} from "@/app/(main-flat)/home/homeTypes";
import { CACHE_TTL_1H, HOME_SCATTER_HARD_CAP } from "@/lib/constants";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { SOT_DATA_LAG_DAYS, addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { aggregateCompetitorPlaylistHistory } from "@/lib/competitorAnalytics";
import { resolveCompetitorLabelKey } from "@/lib/competitorContext";

type Svc = ReturnType<typeof supabaseService>;

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

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function isIsoDateInRange(args: { d: string; start: string; end: string }) {
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

async function fetchTrackScatterPoints(svc: Svc, args: { runDate: string; prevDate: string }) {
  const pageSize = 1000;
  const hardCap = HOME_SCATTER_HARD_CAP;

  const out: Record<string, unknown>[] = [];
  const seenIsrc = new Set<string>();

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await svc
      .rpc("home_track_scatter_points", {
        p_run_date: args.runDate,
        p_prev_date: args.prevDate,
      })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;

    for (const r of rows) {
      const isrc = String(r?.isrc ?? "").trim();
      if (!isrc) continue;
      if (seenIsrc.has(isrc)) continue;
      seenIsrc.add(isrc);
      out.push(r);
    }

    if (rows.length < pageSize) break;
  }

  return out;
}

async function fetchCompetitorTrackScatterPoints(
  svc: Svc,
  args: { labelKey: string; runDate: string; prevDate: string },
) {
  const pageSize = 1000;
  const hardCap = HOME_SCATTER_HARD_CAP;
  const out: Record<string, unknown>[] = [];
  const seenIsrc = new Set<string>();

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = await svc
      .schema("competitor")
      .rpc("home_track_scatter_points_for_label", {
        label_key: args.labelKey,
        run_date: args.runDate,
        prev_date: args.prevDate,
      })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;
    for (const r of rows) {
      const isrc = String(r?.isrc ?? "").trim();
      if (!isrc || seenIsrc.has(isrc)) continue;
      seenIsrc.add(isrc);
      out.push(r);
    }
    if (rows.length < pageSize) break;
  }

  return out;
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

type DistroPlaylistInfo = { name: string; imageUrl: string | null };

type MembershipRow = { isrc: string; playlist_key: string; valid_to: string | null };

async function fetchAllPlaylistMembershipRowsForIsrcChunk(
  svc: Svc,
  runDate: string,
  isrcChunk: string[],
): Promise<{ data: MembershipRow[]; error: { message: string; code?: string } | null }> {
  const pageSize = 1000;
  const allRows: MembershipRow[] = [];
  let from = 0;
  while (true) {
    const res = await svc
      .from("playlist_memberships")
      .select("isrc,playlist_key,valid_to")
      .in("isrc", isrcChunk)
      .lte("valid_from", runDate)
      .range(from, from + pageSize - 1);
    if (res.error) return { data: [], error: res.error };
    const rows = (res.data ?? []) as MembershipRow[];
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return { data: allRows, error: null };
}

async function fetchDistroPlaylistsByKeys(
  svc: Svc,
  playlistKeys: string[],
): Promise<{
  data: Array<{
    playlist_key: string;
    display_name: string | null;
    spotify_playlist_image_url: string | null;
  }>;
  error: { message: string; code?: string } | null;
}> {
  const keyBatchSize = 1000;
  const pageSize = 1000;
  const out: Array<{
    playlist_key: string;
    display_name: string | null;
    spotify_playlist_image_url: string | null;
  }> = [];
  for (let k = 0; k < playlistKeys.length; k += keyBatchSize) {
    const keyBatch = playlistKeys.slice(k, k + keyBatchSize);
    let from = 0;
    while (true) {
      const res = await svc
        .from("playlists")
        .select("playlist_key,display_name,spotify_playlist_image_url")
        .in("playlist_key", keyBatch)
        .eq("playlist_type", "Distro")
        .range(from, from + pageSize - 1);
      if (res.error) return { data: [], error: res.error };
      const rows = (res.data ?? []) as typeof out;
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
  return { data: out, error: null };
}

async function fetchDistroByIsrcForHome(svc: Svc, runDate: string, isrcs: string[]): Promise<Map<string, DistroPlaylistInfo>> {
  const distroByIsrc = new Map<string, DistroPlaylistInfo>();
  const unique = [...new Set(isrcs.filter(Boolean))];
  if (!unique.length || !runDate) return distroByIsrc;

  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const chunkKey = `${i}-${shortHash([...chunk].sort().join(","))}`;

    const { data: memRows, error: memErr } = await cachedQuery(
      async () => fetchAllPlaylistMembershipRowsForIsrcChunk(svc, runDate, chunk),
      `home-scatter-distro-mem-${runDate}-${chunkKey}`,
      CACHE_TTL_1H,
    );
    if (memErr) throw memErr;

    const activeMemRows = ((memRows ?? []) as MembershipRow[]).filter(
      (r) => r.valid_to == null || r.valid_to >= runDate,
    );
    const uniquePlaylistKeys = [...new Set(activeMemRows.map((r) => r.playlist_key))];
    if (!uniquePlaylistKeys.length) continue;

    const plKey = `${chunkKey}-${shortHash(uniquePlaylistKeys.slice().sort().join("|"))}`;

    const { data: plRows, error: plErr } = await cachedQuery(
      async () => fetchDistroPlaylistsByKeys(svc, uniquePlaylistKeys),
      `home-scatter-distro-pl-${runDate}-${plKey}`,
      CACHE_TTL_1H,
    );
    if (plErr) throw plErr;

    const distroPlaylistMap = new Map(
      ((plRows ?? []) as Array<{ playlist_key: string; display_name: string | null; spotify_playlist_image_url: string | null }>).map(
        (p) => [
          p.playlist_key,
          { name: p.display_name ?? p.playlist_key, imageUrl: p.spotify_playlist_image_url ?? null },
        ],
      ),
    );
    for (const r of activeMemRows) {
      const info = distroPlaylistMap.get(r.playlist_key);
      if (info && !distroByIsrc.has(r.isrc)) distroByIsrc.set(r.isrc, info);
    }
  }

  return distroByIsrc;
}

async function fetchTrackMetaByIsrc(svc: Svc, isrcs: string[]) {
  if (!isrcs.length) return new Map<string, TrackMetaRow>();

  const batchSize = 250;
  const out = new Map<string, TrackMetaRow>();
  const sorted = [...isrcs].sort();
  const batches: string[][] = [];
  for (let i = 0; i < sorted.length; i += batchSize) batches.push(sorted.slice(i, i + batchSize));

  const batchResults = await Promise.all(
    batches.map((batch, idx) =>
      cachedQuery(
        async () =>
          await svc
            .from("tracks")
            .select("isrc,name,release_date,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
            .in("isrc", batch),
        `home-track-meta-for-overrides-b${idx}-${batch.join(",")}`,
        CACHE_TTL_1H,
      ),
    ),
  );

  for (const { data, error } of batchResults) {
    if (error) throw error;
    for (const r of (data ?? []) as TrackMetaRow[]) out.set(r.isrc, r);
  }
  return out;
}

export async function loadHomeDashboardData(args: {
  sb: SupabaseClient;
  svc: Svc;
  userId: string;
  sp: HomeDashboardSearchParams;
}): Promise<HomeDashboardServerProps> {
  const { sb, svc, userId, sp } = args;

  let rangeDays = Math.max(7, Math.min(365, Number(sp.range ?? "30") || 30));
  if (sp.start && sp.end) {
    const start = new Date(`${sp.start}T00:00:00Z`);
    const end = new Date(`${sp.end}T00:00:00Z`);
    const calculatedDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    rangeDays = Math.max(1, Math.min(365, calculatedDays));
  }

  const customRangeStart = sanitizeIsoDate(sp.start);
  const customRangeEnd = sanitizeIsoDate(sp.end);

  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const playlistKey: "all_catalog" | "releases" | "ext" =
    scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";

  let hideStaleAnnotations = false;
  let userArtificialSpikeRatio: number | null = null;
  let userIncludeWeekendsOverride: boolean | null = null;
  let datasetMode: "own" | "competitor" = "own";
  let competitorLabelKey: string | null = null;
  let competitorLabelName: string | null = null;
  try {
    const { data: uSettings } = await sb
      .from("user_settings")
      .select(
        "hide_stale_override_annotations, artificial_streams_spike_ratio, artificial_streams_include_weekends_user, dataset_mode, competitor_label_key",
      )
      .eq("user_id", userId)
      .maybeSingle();
    const us = uSettings as Record<string, unknown> | null;
    datasetMode = normalizeDatasetMode(us?.dataset_mode);
    competitorLabelKey =
      typeof us?.competitor_label_key === "string" && us.competitor_label_key.trim()
        ? us.competitor_label_key.trim()
        : null;
    hideStaleAnnotations = Boolean(us?.hide_stale_override_annotations);
    const ur = us?.artificial_streams_spike_ratio;
    if (ur != null && Number.isFinite(Number(ur))) userArtificialSpikeRatio = Number(ur);
    if (typeof us?.artificial_streams_include_weekends_user === "boolean") {
      userIncludeWeekendsOverride = us.artificial_streams_include_weekends_user;
    }
  } catch {
    // graceful fallback
  }

  let artificialSpikeRatio = 1.25;
  let artificialMinBaseline = 50;
  let artificialGraceDays = 14;
  let artificialThresholdCrossing = 1500;
  let artificialIncludeWeekends = false;
  try {
    const { data: hcRows } = await svc
      .from("health_config")
      .select("key,value_numeric")
      .in("key", [
        "artificial_streams_spike_ratio",
        "artificial_streams_min_baseline",
        "artificial_streams_new_track_grace_days",
        "artificial_streams_threshold_crossing_max",
        "artificial_streams_include_weekends",
      ]);
    for (const row of (hcRows ?? []) as Array<{ key?: string; value_numeric?: unknown }>) {
      const k = row.key;
      const v = row.value_numeric;
      if (v == null || !Number.isFinite(Number(v))) continue;
      const n = Number(v);
      if (k === "artificial_streams_spike_ratio") artificialSpikeRatio = n;
      if (k === "artificial_streams_min_baseline") artificialMinBaseline = n;
      if (k === "artificial_streams_new_track_grace_days") artificialGraceDays = Math.round(n);
      if (k === "artificial_streams_threshold_crossing_max") artificialThresholdCrossing = Math.round(n);
      if (k === "artificial_streams_include_weekends") artificialIncludeWeekends = Boolean(Math.round(n));
    }
    if (userArtificialSpikeRatio != null) artificialSpikeRatio = userArtificialSpikeRatio;
    if (userIncludeWeekendsOverride !== null) artificialIncludeWeekends = userIncludeWeekendsOverride;
  } catch {
    // defaults above
  }

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
    // ignore
  }

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
            CACHE_TTL_1H,
          )
        ).data?.spotify_playlist_image_url ?? null;

  if (datasetMode === "competitor" && competitorLabelKey) {
    try {
      const { data: label } = await svc
        .schema("competitor")
        .from("labels")
        .select("display_name")
        .eq("label_key", competitorLabelKey)
        .maybeSingle();
      competitorLabelName = (label as { display_name?: string | null } | null)?.display_name ?? competitorLabelKey;
    } catch {
      competitorLabelName = competitorLabelKey;
    }
  }
  if (datasetMode === "competitor" && !competitorLabelKey) {
    try {
      const { data: labels } = await svc
        .schema("competitor")
        .from("labels")
        .select("label_key,display_name")
        .eq("is_active", true)
        .order("display_name", { ascending: true });
      const typedLabels = (labels ?? []) as Array<{ label_key: string; display_name: string }>;
      competitorLabelKey = resolveCompetitorLabelKey(null, typedLabels);
      competitorLabelName = typedLabels.find((label) => label.label_key === competitorLabelKey)?.display_name ?? competitorLabelKey;
    } catch {
      // Leave null and fall back below.
    }
  }

  const { data: history, error: historyErr } = await cachedQuery<PlaylistDailyStatsRow[]>(
    async () => {
      if (datasetMode === "competitor" && competitorLabelKey) {
        const comp = svc.schema("competitor");
        const { data: playlists } = await comp
          .from("playlists")
          .select("playlist_key")
          .eq("label_key", competitorLabelKey);
        const playlistKeys = ((playlists ?? []) as Array<{ playlist_key: string }>)
          .map((p) => p.playlist_key)
          .filter(Boolean);
        if (!playlistKeys.length) return { data: [], error: null };

        let q = comp
          .from("playlist_daily_stats")
          .select("date,playlist_key,track_count,total_streams_cumulative,daily_streams_net,missing_streams_track_count")
          .in("playlist_key", playlistKeys);
        if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
        const res = await q.order("date", { ascending: false }).limit((rangeDays + 7) * playlistKeys.length);
        return {
          data: aggregateCompetitorPlaylistHistory((res.data ?? []) as any).map((row) => ({
            ...row,
            est_revenue_total: null,
            est_revenue_daily_net: null,
          })),
          error: res.error,
        };
      }

      let q = svc
        .from("playlist_daily_stats")
        .select("date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
        .eq("playlist_key", playlistKey);
      if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
      return await q.order("date", { ascending: false }).limit(rangeDays + 7);
    },
    `home-playlist-stats-v4-${datasetMode}-${competitorLabelKey ?? "none"}-${playlistKey}-${rangeDays + 7}-${userId}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`,
    CACHE_TTL_1H,
  );

  const latest = history && history.length > 0 ? history[0] : null;
  const latestRunDate = (latest as PlaylistDailyStatsRow | null)?.date ?? null;

  const title =
    datasetMode === "competitor"
      ? competitorLabelName ?? competitorLabelKey ?? "Competitor"
      : playlistKey === "releases"
        ? "Releases"
        : playlistKey === "ext"
          ? "ext"
          : "All Catalog";

  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const selectedDataDate = sanitizeIsoDate(sp.xy_date) ?? latestDataDate;

  /** Data dates for UI (matches Home date picker). RPC uses run dates — see spikeFilterRunStart/End. */
  let artificialSpikeDateStart: string | null = null;
  let artificialSpikeDateEnd: string | null = null;
  let spikeFilterRunStart: string | null = null;
  let spikeFilterRunEnd: string | null = null;
  if (customRangeStart && customRangeEnd) {
    artificialSpikeDateStart = customRangeStart;
    artificialSpikeDateEnd = customRangeEnd;
    spikeFilterRunStart = addDaysISO(customRangeStart, SOT_DATA_LAG_DAYS);
    spikeFilterRunEnd = addDaysISO(customRangeEnd, SOT_DATA_LAG_DAYS);
  } else if (latestRunDate && latestDataDate) {
    artificialSpikeDateEnd = latestDataDate;
    artificialSpikeDateStart = addDaysISO(latestDataDate, -(rangeDays - 1));
    spikeFilterRunEnd = latestRunDate;
    spikeFilterRunStart = addDaysIso(latestRunDate, -(rangeDays - 1));
  }
  let selectedRunDate = selectedDataDate ? addDaysISO(selectedDataDate, SOT_DATA_LAG_DAYS) : latestRunDate;
  if (datasetMode === "competitor" && competitorLabelKey && !sp.xy_date) {
    try {
      const { data: latestTrackRow } = await svc
        .schema("competitor")
        .from("track_daily_streams")
        .select("date")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestTrackRunDate = (latestTrackRow as { date?: string } | null)?.date ?? null;
      if (latestTrackRunDate) selectedRunDate = latestTrackRunDate;
    } catch {
      // Keep the history-derived date as a safe fallback.
    }
  }

  const scatterCacheKey = `home-track-scatter-v11-${datasetMode}-${competitorLabelKey ?? "none"}-${selectedRunDate ?? "none"}`;
  const { data: trackScatterPoints, error: trackScatterErr } = await cachedQuery(
    async () => {
      if (!selectedRunDate) return { data: [] as TrackStreamsXYPoint[], error: null };

      const prevRunDate = addDaysIso(selectedRunDate, -1);

      const rows =
        datasetMode === "competitor" && competitorLabelKey
          ? await fetchCompetitorTrackScatterPoints(svc, {
              labelKey: competitorLabelKey,
              runDate: selectedRunDate,
              prevDate: prevRunDate,
            })
          : await fetchTrackScatterPoints(svc, {
              runDate: selectedRunDate,
              prevDate: prevRunDate,
            });

      const points = rows
        .map((r: Record<string, unknown>) => {
          const total = Number(r.total_streams_cumulative ?? 0);
          if (!isFinite(total)) return null;
          const isrc = String(r?.isrc ?? "").trim();
          const name = typeof r?.name === "string" ? r.name : null;
          const release_date = normalizeReleaseDateFromRpc(r?.release_date) ?? null;
          const artist_names = Array.isArray(r?.artist_names) ? (r.artist_names as string[]) : null;
          const artist_ids = Array.isArray(r?.artist_ids) ? (r.artist_ids as string[]) : null;
          const album_image_url = typeof r?.album_image_url === "string" ? r.album_image_url : null;
          const spotify_track_id = typeof r?.spotify_track_id === "string" ? r.spotify_track_id : null;
          return {
            isrc,
            name,
            release_date: release_date ?? undefined,
            artist_names,
            artist_ids,
            album_image_url,
            total_streams_cumulative: total,
            daily_streams_delta: Number(r.daily_streams_delta ?? 0),
            has_prev_day: Boolean(r.has_prev_day),
            spotify_track_id: spotify_track_id ?? undefined,
          } as TrackStreamsXYPoint;
        })
        .filter((p): p is TrackStreamsXYPoint => p !== null);

      const distroByIsrc =
        datasetMode === "competitor"
          ? new Map<string, DistroPlaylistInfo>()
          : await fetchDistroByIsrcForHome(svc, selectedRunDate, points.map((p) => p.isrc));

      const withDistro: TrackStreamsXYPoint[] = points.map((p) => {
        const d = distroByIsrc.get(p.isrc);
        return {
          ...p,
          distroPlaylistName: d?.name ?? null,
          distroPlaylistImageUrl: d?.imageUrl ?? null,
        };
      });

      return { data: withDistro, error: null };
    },
    scatterCacheKey,
    CACHE_TTL_1H,
  );

  const overrideAnnotations: ManualOverrideAnnotation[] = await (async () => {
    if (datasetMode === "competitor") return [];
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
      CACHE_TTL_1H,
    );

    const overrideRows = (overrideRowsRaw ?? []) as TrackOverrideRow[];
    const isrcs = Array.from(new Set(overrideRows.map((r) => (r?.isrc ?? "").trim()).filter(Boolean)));
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
      CACHE_TTL_1H,
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
      const annTitle =
        artist && trackName ? `${artist} - ${trackName}` : trackName ? trackName : artist ? artist : isrc;

      out.push({
        date: dataDateFromRunDate(d),
        title: annTitle,
        imageUrl: meta?.spotify_album_image_url ?? null,
        note: (o.note ?? "").trim() || `Manual override (ISRC: ${isrc})`,
      });
    }

    return out;
  })();

  const artificialSpikesCacheKey = `home-artificial-stream-spikes-v3-${userId}-${artificialSpikeRatio}-${artificialMinBaseline}-${artificialGraceDays}-${artificialThresholdCrossing}-${artificialIncludeWeekends ? "wknd1" : "wknd0"}-${spikeFilterRunStart ?? "none"}-${spikeFilterRunEnd ?? "none"}`;

  const [
    { data: artistWeekendDips },
    { data: trackWeekendDips },
    { data: negativeDailyStreams },
    { data: artificialStreamSpikesRaw },
  ] = await Promise.all([
    cachedQuery(
      async () => {
        if (datasetMode === "competitor") return { data: [], error: null };
        return await svc.rpc("home_artist_weekend_dips", {
          p_min_weekday_avg: 0,
          p_anchor_data_date: latestDataDate ?? null,
        });
      },
      `home-artist-weekend-dips-${playlistKey}-${latestDataDate ?? "none"}-${userId}`,
      CACHE_TTL_1H,
    ),
    cachedQuery(
      async () => {
        if (datasetMode === "competitor") return { data: [], error: null };
        return await svc.rpc("home_track_weekend_dips", {
          p_min_weekday_avg: 0,
          p_anchor_data_date: latestDataDate ?? null,
        });
      },
      `home-track-weekend-dips-${playlistKey}-${latestDataDate ?? "none"}-${userId}`,
      CACHE_TTL_1H,
    ),
    cachedQuery(
      async () => {
        if (datasetMode === "competitor") return { data: [], error: null };
        return await svc.rpc("home_negative_daily_streams");
      },
      `home-negative-daily-v2-${userId}`,
      CACHE_TTL_1H,
    ),
    cachedQuery(
      async () => {
        if (datasetMode === "competitor") return { data: [], error: null };
        const { data, error } = await svc.rpc("home_artificial_stream_spikes", {
          p_spike_ratio: artificialSpikeRatio,
          p_min_baseline: artificialMinBaseline,
          p_grace_days: artificialGraceDays,
          p_threshold_crossing_max: artificialThresholdCrossing,
          p_include_weekends: artificialIncludeWeekends,
          p_start_date: spikeFilterRunStart,
          p_end_date: spikeFilterRunEnd,
        });
        return { data, error };
      },
      artificialSpikesCacheKey,
      CACHE_TTL_1H,
    ),
  ]);

  const artificialStreamSpikes: ArtificialStreamSpikeRow[] = ((artificialStreamSpikesRaw ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      isrc: String(r.isrc ?? "").trim(),
      name: typeof r.name === "string" ? r.name : String(r.isrc ?? ""),
      artist_names: Array.isArray(r.artist_names) ? (r.artist_names as string[]) : null,
      artist_ids: Array.isArray(r.artist_ids) ? (r.artist_ids as string[]) : null,
      album_image_url: typeof r.album_image_url === "string" ? r.album_image_url : null,
      date: String(r.date ?? "").slice(0, 10),
      daily_streams: Number(r.daily_streams ?? 0) || 0,
      avg_same_dow:
        r.avg_same_dow != null && Number.isFinite(Number(r.avg_same_dow)) ? Number(r.avg_same_dow) : null,
      spike_ratio:
        r.spike_ratio != null && Number.isFinite(Number(r.spike_ratio)) ? Number(r.spike_ratio) : null,
      streams_cumulative: Number(r.streams_cumulative ?? 0) || 0,
    }),
  );

  return {
    sp,
    datasetMode,
    playlistKey,
    title,
    rangeDays,
    latest: latest as PlaylistDailyStatsRow | null,
    history: (history as PlaylistDailyStatsRow[] | null) ?? [],
    playlistImageUrl,
    historyErrorMessage: historyErr?.message ?? null,
    trackScatterPoints: trackScatterPoints ?? [],
    trackScatterErrorMessage: trackScatterErr?.message ?? null,
    trackScatterDataDate: selectedDataDate,
    latestRunDate,
    latestDataDate,
    overrideAnnotations,
    artistWeekendDips: (artistWeekendDips as ArtistWeekendDipRow[] | null) ?? [],
    trackWeekendDips: (trackWeekendDips as TrackWeekendDipRow[] | null) ?? [],
    negativeDailyStreams: (negativeDailyStreams as NegativeDailyStreamsRow[] | null) ?? [],
    artificialStreamSpikes,
    artificialStreamSpikeRatio: artificialSpikeRatio,
    artificialMinBaseline: artificialMinBaseline,
    artificialIncludeWeekends,
    artificialSpikeDateStart,
    artificialSpikeDateEnd,
  };
}
