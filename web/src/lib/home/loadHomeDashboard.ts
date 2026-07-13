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
import type { HomeDiagnosticsApiPayload } from "@/lib/home/homeDiagnosticsApi";
import { CACHE_TTL_1H, HOME_SCATTER_HARD_CAP } from "@/lib/constants";
import { getRollbackDate, rollbackDataDateToRunDate } from "@/lib/rollback";
import { SOT_DATA_LAG_DAYS, addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { aggregateCompetitorPlaylistHistory } from "@/lib/competitorAnalytics";
import { ALL_COMPETITORS_KEY, resolveCompetitorLabelKey } from "@/lib/competitorContext";
import { timedServerStep } from "@/lib/serverTiming";

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

type MemberPlaylistInfo = { key: string; name: string; imageUrl: string | null };

async function fetchCompetitorPlaylistsByIsrcForHome(
  svc: Svc,
  runDate: string,
  isrcs: string[],
  competitorLabelKey: string | null,
): Promise<Map<string, MemberPlaylistInfo[]>> {
  const byIsrc = new Map<string, MemberPlaylistInfo[]>();
  const unique = [...new Set(isrcs.filter(Boolean))];
  if (!unique.length || !runDate) return byIsrc;

  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const chunkKey = `${i}-${shortHash([...chunk].sort().join(","))}-${competitorLabelKey ?? "all"}`;

    const { data: memRows, error: memErr } = await cachedQuery(
      async () => {
        const q = svc
          .schema("competitor")
          .from("playlist_memberships")
          .select("isrc,playlist_key")
          .in("isrc", chunk)
          .lte("valid_from", runDate)
          .or(`valid_to.is.null,valid_to.gte.${runDate}`);
        return await q;
      },
      `home-scatter-comp-pl-mem-${runDate}-${chunkKey}`,
      CACHE_TTL_1H,
    );
    if (memErr) throw memErr;

    const memberships = (memRows ?? []) as Array<{ isrc: string; playlist_key: string }>;
    const playlistKeys = [...new Set(memberships.map((r) => r.playlist_key).filter(Boolean))];
    if (!playlistKeys.length) continue;

    const { data: plRows, error: plErr } = await cachedQuery(
      async () => {
        let q = svc
          .schema("competitor")
          .from("playlists")
          .select("playlist_key,display_name,spotify_playlist_image_url,display_order")
          .in("playlist_key", playlistKeys)
          .eq("is_active", true);
        if (competitorLabelKey) q = q.eq("label_key", competitorLabelKey);
        return await q.order("display_order", { ascending: true, nullsFirst: false }).order("display_name", {
          ascending: true,
        });
      },
      `home-scatter-comp-pl-meta-${runDate}-${chunkKey}`,
      CACHE_TTL_1H,
    );
    if (plErr) throw plErr;

    const playlistMeta = new Map(
      ((plRows ?? []) as Array<{
        playlist_key: string;
        display_name: string | null;
        spotify_playlist_image_url: string | null;
      }>).map((p) => [
        p.playlist_key,
        {
          key: p.playlist_key,
          name: (p.display_name ?? p.playlist_key).trim(),
          imageUrl: p.spotify_playlist_image_url ?? null,
        },
      ]),
    );

    for (const m of memberships) {
      const pl = playlistMeta.get(m.playlist_key);
      if (!pl) continue;
      const list = byIsrc.get(m.isrc) ?? [];
      if (!list.some((x) => x.key === pl.key)) list.push(pl);
      byIsrc.set(m.isrc, list);
    }
  }

  return byIsrc;
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

export async function resolveHomeScatterSelection(args: {
  svc: Svc;
  sp: HomeDashboardSearchParams;
  datasetMode: "own" | "competitor";
  competitorLabelKey: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
}) {
  const { svc, sp, datasetMode, competitorLabelKey, latestRunDate, latestDataDate } = args;
  const selectedDataDate = sanitizeIsoDate(sp.xy_date) ?? latestDataDate;
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

  return { selectedDataDate, selectedRunDate };
}

export async function loadHomeScatterPoints(args: {
  svc: Svc;
  datasetMode: "own" | "competitor";
  competitorLabelKey: string | null;
  competitorLabelName: string | null;
  selectedRunDate: string | null;
}): Promise<{ points: TrackStreamsXYPoint[]; errorMessage: string | null }> {
  const { svc, datasetMode, competitorLabelKey, competitorLabelName, selectedRunDate } = args;
  const scatterCacheKey = `home-track-scatter-v11-${datasetMode}-${competitorLabelKey ?? "none"}-${selectedRunDate ?? "none"}`;
  const { data: trackScatterPoints, error: trackScatterErr } = await cachedQuery(
    async () => {
      if (!selectedRunDate) return { data: [] as TrackStreamsXYPoint[], error: null };

      const prevRunDate = addDaysIso(selectedRunDate, -1);

      const rows =
        datasetMode === "competitor" && competitorLabelKey
          ? competitorLabelKey === ALL_COMPETITORS_KEY
            ? (
                await Promise.all(
                  (
                    (
                      await svc
                        .schema("competitor")
                        .from("labels")
                        .select("label_key,display_name")
                        .eq("is_active", true)
                    ).data ?? []
                  ).map(async (label: { label_key: string; display_name: string }) =>
                    (await fetchCompetitorTrackScatterPoints(svc, {
                      labelKey: label.label_key,
                      runDate: selectedRunDate,
                      prevDate: prevRunDate,
                    })).map((row) => ({
                      ...row,
                      competitor_label_key: label.label_key,
                      competitor_label_name: label.display_name,
                    })),
                  ),
                )
              ).flat()
            : (await fetchCompetitorTrackScatterPoints(svc, {
                labelKey: competitorLabelKey,
                runDate: selectedRunDate,
                prevDate: prevRunDate,
              })).map((row) => ({
                ...row,
                competitor_label_key: competitorLabelKey,
                competitor_label_name: competitorLabelName ?? competitorLabelKey,
              }))
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

      if (datasetMode === "competitor") {
        const labelKeyForMemberships =
          competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY ? competitorLabelKey : null;
        const playlistsByIsrc = await fetchCompetitorPlaylistsByIsrcForHome(
          svc,
          selectedRunDate,
          points.map((p) => p.isrc),
          labelKeyForMemberships,
        );
        const withPlaylists: TrackStreamsXYPoint[] = points.map((p) => ({
          ...p,
          memberPlaylists: playlistsByIsrc.get(p.isrc) ?? [],
        }));
        return { data: withPlaylists, error: null };
      }

      const distroByIsrc = await fetchDistroByIsrcForHome(svc, selectedRunDate, points.map((p) => p.isrc));

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

  return {
    points: trackScatterPoints ?? [],
    errorMessage: trackScatterErr?.message ?? null,
  };
}

export async function loadHomeScatterDataForUser(args: {
  svc: Svc;
  userId: string;
  sp: HomeDashboardSearchParams;
}): Promise<{ points: TrackStreamsXYPoint[]; errorMessage: string | null; dataDate: string | null }> {
  const { svc, userId, sp } = args;
  const scope = (sp.scope ?? "all_catalog").toLowerCase();
  const playlistKey: "all_catalog" | "releases" | "ext" =
    scope === "releases" ? "releases" : scope === "ext" ? "ext" : "all_catalog";

  // Settings and rollback date are independent; fetch them together.
  const [settingsRes, rollbackDate] = await Promise.all([
    svc
      .from("user_settings")
      .select("dataset_mode,competitor_label_key")
      .eq("user_id", userId)
      .maybeSingle(),
    getRollbackDate(),
  ]);
  const settings = settingsRes.data;
  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  let competitorLabelKey =
    typeof settings?.competitor_label_key === "string" && settings.competitor_label_key.trim()
      ? settings.competitor_label_key.trim()
      : null;
  let competitorLabelName: string | null = null;

  if (datasetMode === "competitor" && competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY) {
    const { data: label } = await svc
      .schema("competitor")
      .from("labels")
      .select("display_name")
      .eq("label_key", competitorLabelKey)
      .maybeSingle();
    competitorLabelName = (label as { display_name?: string | null } | null)?.display_name ?? competitorLabelKey;
  }
  if (datasetMode === "competitor" && (!competitorLabelKey || competitorLabelKey === ALL_COMPETITORS_KEY)) {
    const { data: labels } = await svc
      .schema("competitor")
      .from("labels")
      .select("label_key,display_name")
      .eq("is_active", true)
      .order("display_name", { ascending: true });
    const typedLabels = (labels ?? []) as Array<{ label_key: string; display_name: string }>;
    competitorLabelKey = competitorLabelKey === ALL_COMPETITORS_KEY ? ALL_COMPETITORS_KEY : resolveCompetitorLabelKey(null, typedLabels);
    competitorLabelName =
      competitorLabelKey === ALL_COMPETITORS_KEY
        ? "All Competitors"
        : typedLabels.find((label) => label.label_key === competitorLabelKey)?.display_name ?? competitorLabelKey;
  }

  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;

  const { data: latestRow } = await cachedQuery<{ date: string } | null>(
    async () => {
      if (datasetMode === "competitor" && competitorLabelKey) {
        const comp = svc.schema("competitor");
        let playlistsQuery = comp.from("playlists").select("playlist_key").eq("is_active", true);
        if (competitorLabelKey !== ALL_COMPETITORS_KEY) playlistsQuery = playlistsQuery.eq("label_key", competitorLabelKey);
        const { data: playlists, error: plErr } = await playlistsQuery;
        if (plErr) return { data: null, error: plErr };
        const playlistKeys = ((playlists ?? []) as Array<{ playlist_key: string }>).map((p) => p.playlist_key).filter(Boolean);
        if (!playlistKeys.length) return { data: null, error: null };
        let q = comp.from("playlist_daily_stats").select("date").in("playlist_key", playlistKeys);
        if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
        return await q.order("date", { ascending: false }).limit(1).maybeSingle();
      }

      let q = svc.from("playlist_daily_stats").select("date").eq("playlist_key", playlistKey);
      if (rollbackRunDate) q = q.lte("date", rollbackRunDate);
      return await q.order("date", { ascending: false }).limit(1).maybeSingle();
    },
    `home-scatter-latest-date-v1-${datasetMode}-${competitorLabelKey ?? "none"}-${playlistKey}-rb${rollbackDate ?? "live"}`,
    CACHE_TTL_1H,
  );

  const latestRunDate = latestRow?.date ?? null;
  const latestDataDate = latestRunDate ? dataDateFromRunDate(latestRunDate) : null;
  const { selectedDataDate, selectedRunDate } = await resolveHomeScatterSelection({
    svc,
    sp,
    datasetMode,
    competitorLabelKey,
    latestRunDate,
    latestDataDate,
  });
  const scatter = await loadHomeScatterPoints({
    svc,
    datasetMode,
    competitorLabelKey,
    competitorLabelName,
    selectedRunDate,
  });

  return { points: scatter.points, errorMessage: scatter.errorMessage, dataDate: selectedDataDate };
}

export async function loadHomeDiagnosticsDataForUser(args: {
  sb: SupabaseClient;
  svc: Svc;
  userId: string;
  sp: HomeDashboardSearchParams;
}): Promise<HomeDiagnosticsApiPayload> {
  const props = await loadHomeDashboardData({
    ...args,
    includeScatter: false,
    includeDiagnostics: true,
  });

  return {
    artistWeekendDips: props.artistWeekendDips,
    trackWeekendDips: props.trackWeekendDips,
    negativeDailyStreams: props.negativeDailyStreams,
    artificialStreamSpikes: props.artificialStreamSpikes,
    errorMessage: props.homeDiagnosticsErrorMessage ?? null,
  };
}

export async function loadHomeDashboardData(args: {
  sb: SupabaseClient;
  svc: Svc;
  userId: string;
  sp: HomeDashboardSearchParams;
  includeScatter?: boolean;
  includeDiagnostics?: boolean;
}): Promise<HomeDashboardServerProps> {
  const { sb, svc, userId, sp } = args;
  const includeScatter = args.includeScatter ?? true;
  const includeDiagnostics = args.includeDiagnostics ?? true;

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

  // ---------------------------------------------------------------------------
  // Independent up-front fetches. These have no data dependencies on each other,
  // so we run them in parallel to shave several round-trips off the perceived
  // load time (especially noticeable after a competitor switch).
  // ---------------------------------------------------------------------------
  const userSettingsPromise = (async () => {
    try {
      const { data } = await sb
        .from("user_settings")
        .select(
          "hide_stale_override_annotations, artificial_streams_spike_ratio, artificial_streams_include_weekends_user, dataset_mode, competitor_label_key",
        )
        .eq("user_id", userId)
        .maybeSingle();
      return data as Record<string, unknown> | null;
    } catch {
      return null;
    }
  })();

  const healthConfigPromise = (async () => {
    try {
      const { data } = await svc
        .from("health_config")
        .select("key,value_numeric")
        .in("key", [
          "artificial_streams_spike_ratio",
          "artificial_streams_min_baseline",
          "artificial_streams_new_track_grace_days",
          "artificial_streams_threshold_crossing_max",
          "artificial_streams_include_weekends",
        ]);
      return (data ?? []) as Array<{ key?: string; value_numeric?: unknown }>;
    } catch {
      return [];
    }
  })();

  const overrideBusterPromise = (async () => {
    try {
      const { count, data: latestOverride } = await svc
        .from("track_daily_stream_overrides")
        .select("id", { count: "exact" })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      const maxId = Number((latestOverride as { id: number } | null)?.id ?? 0);
      const total = Number(count ?? 0);
      return `${total}-${maxId}`;
    } catch {
      return "0";
    }
  })();

  const rollbackDatePromise = getRollbackDate();

  const playlistImagePromise =
    playlistKey === "all_catalog"
      ? Promise.resolve(null as string | null)
      : cachedQuery<{ spotify_playlist_image_url: string | null }>(
          async () =>
            await svc
              .from("playlists")
              .select("spotify_playlist_image_url")
              .eq("playlist_key", playlistKey)
              .maybeSingle(),
          `home-playlist-image-${playlistKey}`,
          CACHE_TTL_1H,
        ).then((r) => r.data?.spotify_playlist_image_url ?? null);

  const [uSettings, hcRows, overrideBuster, rollbackDate, playlistImageUrl] = await Promise.all([
    userSettingsPromise,
    healthConfigPromise,
    overrideBusterPromise,
    rollbackDatePromise,
    playlistImagePromise,
  ]);

  // Unpack user settings into the existing variable shape.
  let hideStaleAnnotations = false;
  let userArtificialSpikeRatio: number | null = null;
  let userIncludeWeekendsOverride: boolean | null = null;
  let datasetMode: "own" | "competitor" = "own";
  let competitorLabelKey: string | null = null;
  let competitorLabelName: string | null = null;
  if (uSettings) {
    datasetMode = normalizeDatasetMode(uSettings.dataset_mode);
    competitorLabelKey =
      typeof uSettings.competitor_label_key === "string" && uSettings.competitor_label_key.trim()
        ? (uSettings.competitor_label_key as string).trim()
        : null;
    hideStaleAnnotations = Boolean(uSettings.hide_stale_override_annotations);
    const ur = uSettings.artificial_streams_spike_ratio;
    if (ur != null && Number.isFinite(Number(ur))) userArtificialSpikeRatio = Number(ur);
    if (typeof uSettings.artificial_streams_include_weekends_user === "boolean") {
      userIncludeWeekendsOverride = uSettings.artificial_streams_include_weekends_user;
    }
  }

  // Apply health_config + user overrides.
  let artificialSpikeRatio = 1.25;
  let artificialMinBaseline = 50;
  let artificialGraceDays = 14;
  let artificialThresholdCrossing = 1500;
  let artificialIncludeWeekends = false;
  for (const row of hcRows) {
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

  const rollbackRunDate = rollbackDate ? rollbackDataDateToRunDate(rollbackDate) : null;

  // Competitor name + playlists lookups are independent of each other, so run them in
  // parallel when we're in Competitor Mode.
  let competitorPlaylists: HomeDashboardServerProps["competitorPlaylists"] = [];
  if (datasetMode === "competitor") {
    const isSpecificCompetitor =
      !!competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY;

    const labelNamePromise: Promise<string | null> = (async () => {
      if (isSpecificCompetitor) {
        try {
          const { data: label } = await svc
            .schema("competitor")
            .from("labels")
            .select("display_name")
            .eq("label_key", competitorLabelKey!)
            .maybeSingle();
          return (label as { display_name?: string | null } | null)?.display_name ?? competitorLabelKey!;
        } catch {
          return competitorLabelKey;
        }
      }
      // "All Competitors" or unset — need the labels list to resolve a name + fallback key.
      try {
        const { data: labels } = await svc
          .schema("competitor")
          .from("labels")
          .select("label_key,display_name")
          .eq("is_active", true)
          .order("display_name", { ascending: true });
        const typedLabels = (labels ?? []) as Array<{ label_key: string; display_name: string }>;
        const resolvedKey =
          competitorLabelKey === ALL_COMPETITORS_KEY
            ? ALL_COMPETITORS_KEY
            : resolveCompetitorLabelKey(null, typedLabels);
        competitorLabelKey = resolvedKey;
        return resolvedKey === ALL_COMPETITORS_KEY
          ? "All Competitors"
          : typedLabels.find((label) => label.label_key === resolvedKey)?.display_name ?? resolvedKey;
      } catch {
        return null;
      }
    })();

    const playlistsPromise: Promise<HomeDashboardServerProps["competitorPlaylists"]> = isSpecificCompetitor
      ? (async () => {
          try {
            const { data: plRows } = await svc
              .schema("competitor")
              .from("playlists")
              .select("playlist_key,display_name,spotify_playlist_image_url")
              .eq("label_key", competitorLabelKey!)
              .eq("is_active", true)
              .order("display_order", { ascending: true, nullsFirst: false })
              .order("display_name", { ascending: true });
            return (plRows ?? []).map(
              (p: {
                playlist_key?: unknown;
                display_name?: unknown;
                spotify_playlist_image_url?: unknown;
              }) => ({
                playlist_key: String(p.playlist_key ?? ""),
                display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
                spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
              }),
            );
          } catch {
            return [];
          }
        })()
      : Promise.resolve([]);

    const [resolvedName, resolvedPlaylists] = await Promise.all([labelNamePromise, playlistsPromise]);
    competitorLabelName = resolvedName;
    competitorPlaylists = resolvedPlaylists;
  }

  let headerPlaylistImageUrl = playlistImageUrl;
  if (
    datasetMode === "competitor" &&
    competitorLabelKey &&
    competitorLabelKey !== ALL_COMPETITORS_KEY
  ) {
    const competitorImageUrl =
      competitorPlaylists.find((p) => p.spotify_playlist_image_url)?.spotify_playlist_image_url ?? null;
    if (competitorImageUrl) headerPlaylistImageUrl = competitorImageUrl;
  }

  const { data: history, error: historyErr } = await cachedQuery<PlaylistDailyStatsRow[]>(
    async () => {
      if (datasetMode === "competitor" && competitorLabelKey) {
        const comp = svc.schema("competitor");
        let playlistsQuery = comp
          .from("playlists")
          .select("playlist_key")
          .eq("is_active", true);
        if (competitorLabelKey !== ALL_COMPETITORS_KEY) playlistsQuery = playlistsQuery.eq("label_key", competitorLabelKey);
        const { data: playlists } = await playlistsQuery;
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
    `home-playlist-stats-v5-${datasetMode}-${competitorLabelKey ?? "none"}-${playlistKey}-${rangeDays + 7}-ov${overrideBuster}-rb${rollbackDate ?? "live"}`,
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

  /** Data dates for UI (matches Home date picker). RPC uses run dates — see spikeFilterRunStart/End. */
  let artificialSpikeDateStart: string | null = null;
  let artificialSpikeDateEnd: string | null = null;
  let spikeFilterRunStart: string | null = null;
  let spikeFilterRunEnd: string | null = null;
  if (customRangeStart && customRangeEnd) {
    artificialSpikeDateStart = customRangeStart;
    artificialSpikeDateEnd = customRangeEnd;
    if (datasetMode === "competitor") {
      spikeFilterRunStart = customRangeStart;
      spikeFilterRunEnd = customRangeEnd;
    } else {
      spikeFilterRunStart = addDaysISO(customRangeStart, SOT_DATA_LAG_DAYS);
      spikeFilterRunEnd = addDaysISO(customRangeEnd, SOT_DATA_LAG_DAYS);
    }
  } else if (latestRunDate && (datasetMode === "competitor" || latestDataDate)) {
    if (datasetMode === "competitor") {
      artificialSpikeDateEnd = latestRunDate;
      artificialSpikeDateStart = addDaysIso(latestRunDate, -(rangeDays - 1));
      spikeFilterRunEnd = latestRunDate;
      spikeFilterRunStart = addDaysIso(latestRunDate, -(rangeDays - 1));
    } else if (latestDataDate) {
      artificialSpikeDateEnd = latestDataDate;
      artificialSpikeDateStart = addDaysISO(latestDataDate, -(rangeDays - 1));
      spikeFilterRunEnd = latestRunDate;
      spikeFilterRunStart = addDaysIso(latestRunDate, -(rangeDays - 1));
    }
  }
  // ---------------------------------------------------------------------------
  // Scatter points, override annotations, and diagnostics only depend on the
  // history result and the sync-computed ranges above, so run them concurrently.
  // ---------------------------------------------------------------------------
  const scatterPromise = (async () => {
    const { selectedDataDate, selectedRunDate } = await resolveHomeScatterSelection({
      svc,
      sp,
      datasetMode,
      competitorLabelKey,
      latestRunDate,
      latestDataDate,
    });
    const scatter = includeScatter
      ? await loadHomeScatterPoints({
          svc,
          datasetMode,
          competitorLabelKey,
          competitorLabelName,
          selectedRunDate,
        })
      : { points: [] as TrackStreamsXYPoint[], errorMessage: null };
    return { selectedDataDate, scatter };
  })();

  const overrideAnnotationsPromise: Promise<ManualOverrideAnnotation[]> = (async () => {
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

  const competitorRpcLabelKey =
    datasetMode === "competitor" && competitorLabelKey && competitorLabelKey !== ALL_COMPETITORS_KEY
      ? competitorLabelKey
      : null;
  const weekendAnchorDate = datasetMode === "competitor" ? latestRunDate : latestDataDate;

  const artificialSpikesCacheKey = `home-artificial-stream-spikes-v5-${datasetMode}-${competitorRpcLabelKey ?? "none"}-${artificialSpikeRatio}-${artificialMinBaseline}-${artificialGraceDays}-${artificialThresholdCrossing}-${artificialIncludeWeekends ? "wknd1" : "wknd0"}-${spikeFilterRunStart ?? "none"}-${spikeFilterRunEnd ?? "none"}`;

  const diagnosticsPromise = includeDiagnostics
    ? timedServerStep("home.diagnostics", () =>
      Promise.all([
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_artist_weekend_dips", {
                p_min_weekday_avg: 0,
                p_anchor_snapshot_date: weekendAnchorDate ?? null,
                p_label_key: competitorRpcLabelKey,
              });
            }
            return await svc.rpc("home_artist_weekend_dips", {
              p_min_weekday_avg: 0,
              p_anchor_data_date: latestDataDate ?? null,
            });
          },
          `home-artist-weekend-dips-v3-${datasetMode}-${competitorRpcLabelKey ?? "none"}-${playlistKey}-${weekendAnchorDate ?? "none"}`,
          CACHE_TTL_1H,
        ),
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_track_weekend_dips", {
                p_min_weekday_avg: 0,
                p_anchor_snapshot_date: weekendAnchorDate ?? null,
                p_label_key: competitorRpcLabelKey,
              });
            }
            return await svc.rpc("home_track_weekend_dips", {
              p_min_weekday_avg: 0,
              p_anchor_data_date: latestDataDate ?? null,
            });
          },
          `home-track-weekend-dips-v3-${datasetMode}-${competitorRpcLabelKey ?? "none"}-${playlistKey}-${weekendAnchorDate ?? "none"}`,
          CACHE_TTL_1H,
        ),
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_negative_daily_streams", {
                p_label_key: competitorRpcLabelKey,
              });
            }
            return await svc.rpc("home_negative_daily_streams");
          },
          `home-negative-daily-v4-${datasetMode}-${competitorRpcLabelKey ?? "none"}`,
          CACHE_TTL_1H,
        ),
        cachedQuery(
          async () => {
            if (datasetMode === "competitor") {
              return await svc.schema("competitor").rpc("home_artificial_stream_spikes", {
                p_spike_ratio: artificialSpikeRatio,
                p_min_baseline: artificialMinBaseline,
                p_grace_days: artificialGraceDays,
                p_threshold_crossing_max: artificialThresholdCrossing,
                p_include_weekends: artificialIncludeWeekends,
                p_start_date: spikeFilterRunStart,
                p_end_date: spikeFilterRunEnd,
                p_label_key: competitorRpcLabelKey,
              });
            }
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
      ]),
    )
    : null;

  const [{ selectedDataDate, scatter }, overrideAnnotations, diagnosticsResults] = await Promise.all([
    scatterPromise,
    overrideAnnotationsPromise,
    diagnosticsPromise,
  ]);

  let artistWeekendDipsRaw: unknown[] = [];
  let trackWeekendDipsRaw: unknown[] = [];
  let negativeDailyStreamsRaw: unknown[] = [];
  let artificialStreamSpikesRaw: unknown[] = [];
  let homeDiagnosticsErrorMessage: string | null = null;

  if (diagnosticsResults) {
    const [
      artistWeekendDipsResult,
      trackWeekendDipsResult,
      negativeDailyStreamsResult,
      artificialStreamSpikesResult,
    ] = diagnosticsResults;
    artistWeekendDipsRaw = (artistWeekendDipsResult.data ?? []) as unknown[];
    trackWeekendDipsRaw = (trackWeekendDipsResult.data ?? []) as unknown[];
    negativeDailyStreamsRaw = (negativeDailyStreamsResult.data ?? []) as unknown[];
    artificialStreamSpikesRaw = (artificialStreamSpikesResult.data ?? []) as unknown[];
    homeDiagnosticsErrorMessage =
      artistWeekendDipsResult.error?.message ??
      trackWeekendDipsResult.error?.message ??
      negativeDailyStreamsResult.error?.message ??
      artificialStreamSpikesResult.error?.message ??
      null;
  }

  const artificialStreamSpikes: ArtificialStreamSpikeRow[] = (artificialStreamSpikesRaw as Record<string, unknown>[]).map(
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
    competitorLabelKey,
    competitorPlaylists,
    playlistKey,
    title,
    rangeDays,
    latest: latest as PlaylistDailyStatsRow | null,
    history: (history as PlaylistDailyStatsRow[] | null) ?? [],
    playlistImageUrl: headerPlaylistImageUrl,
    historyErrorMessage: historyErr?.message ?? null,
    trackScatterPoints: scatter.points,
    trackScatterErrorMessage: scatter.errorMessage,
    trackScatterDataDate: selectedDataDate,
    trackScatterDeferred: !includeScatter,
    latestRunDate,
    latestDataDate,
    overrideAnnotations,
    artistWeekendDips: (artistWeekendDipsRaw as ArtistWeekendDipRow[] | null) ?? [],
    trackWeekendDips: (trackWeekendDipsRaw as TrackWeekendDipRow[] | null) ?? [],
    negativeDailyStreams: (negativeDailyStreamsRaw as NegativeDailyStreamsRow[] | null) ?? [],
    artificialStreamSpikes,
    homeDiagnosticsDeferred: !includeDiagnostics,
    homeDiagnosticsErrorMessage,
    artificialStreamSpikeRatio: artificialSpikeRatio,
    artificialMinBaseline: artificialMinBaseline,
    artificialIncludeWeekends,
    artificialSpikeDateStart,
    artificialSpikeDateEnd,
  };
}
