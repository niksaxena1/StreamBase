/**
 * Competitor workspace insights (Movement + Catalog intelligence).
 *
 * Lives outside the route file so the post-ingestion revalidation hook can warm
 * these caches directly — Next route modules may only export handlers/config.
 */
import {
  buildCatalogInsights,
  buildRosterMovement,
  type CatalogTrackPoint,
} from "@/app/(main-flat)/competitors/competitorWorkspaceAnalytics";
import type {
  CompetitorCatalogInsights,
  CompetitorMovementInsights,
} from "@/app/(main-flat)/competitors/competitorsTypes";
import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";

type PlaylistIdentity = {
  playlist_key: string;
  label_key: string;
};

type LabelIdentity = {
  label_key: string;
  display_name: string;
  is_active: boolean;
};

type MembershipRow = {
  isrc: string;
  playlist_key: string;
  valid_from: string;
  valid_to: string | null;
};

type TrackMetaRow = {
  isrc: string;
  name: string | null;
  spotify_artist_names: string[] | null;
  spotify_album_image_url: string | null;
};

type ScatterRow = {
  isrc: string;
  release_date: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
  total_streams_cumulative: number | string | null;
  daily_streams_delta: number | string | null;
};

type CompetitorSchemaClient = ReturnType<ReturnType<typeof supabaseService>["schema"]>;

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function loadMembershipPages(args: {
  comp: CompetitorSchemaClient;
  field?: "valid_from" | "valid_to";
  start?: string;
  end?: string;
  isrcs?: string[];
}): Promise<{ data: MembershipRow[] | null; error: { message: string } | null }> {
  const rows: MembershipRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = args.comp
      .from("playlist_memberships")
      .select("isrc,playlist_key,valid_from,valid_to")
      .order("isrc", { ascending: true })
      .order("valid_from", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.field && args.start && args.end) {
      query = query.gte(args.field, args.start).lte(args.field, args.end);
    }
    if (args.isrcs?.length) query = query.in("isrc", args.isrcs);
    const page = await query;
    if (page.error) return { data: null, error: page.error };
    const batch = (page.data ?? []) as MembershipRow[];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
}

function mergeMembershipIntervals(
  rows: MembershipRow[],
  playlistToLabel: Map<string, string>,
): Map<string, Array<{ labelKey: string; start: string; end: string | null }>> {
  const byTrackLabel = new Map<string, Array<{ start: string; end: string | null }>>();
  for (const row of rows) {
    const labelKey = playlistToLabel.get(row.playlist_key);
    if (!labelKey) continue;
    const key = `${row.isrc}\u0000${labelKey}`;
    const intervals = byTrackLabel.get(key) ?? [];
    intervals.push({ start: row.valid_from.slice(0, 10), end: row.valid_to?.slice(0, 10) ?? null });
    byTrackLabel.set(key, intervals);
  }

  const byIsrc = new Map<string, Array<{ labelKey: string; start: string; end: string | null }>>();
  for (const [key, intervals] of byTrackLabel) {
    const [isrc, labelKey] = key.split("\u0000");
    intervals.sort((a, b) => a.start.localeCompare(b.start));
    const merged: Array<{ start: string; end: string | null }> = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (!previous) {
        merged.push({ ...interval });
        continue;
      }
      const touches = previous.end == null || interval.start <= addDaysISO(previous.end, 1);
      if (!touches) {
        merged.push({ ...interval });
        continue;
      }
      if (previous.end == null || interval.end == null) previous.end = null;
      else if (interval.end > previous.end) previous.end = interval.end;
    }
    const output = byIsrc.get(isrc) ?? [];
    merged.forEach((interval) => output.push({ labelKey, ...interval }));
    byIsrc.set(isrc, output);
  }
  return byIsrc;
}

async function loadMovementInsights(args: {
  runDate: string;
  playlists: PlaylistIdentity[];
  labels: LabelIdentity[];
}): Promise<{ data: CompetitorMovementInsights | null; error: { message: string } | null }> {
  const comp = supabaseService().schema("competitor");
  const windowStart = addDaysISO(args.runDate, -29);
  const [additionCandidates, removalCandidates] = await Promise.all([
    loadMembershipPages({ comp, field: "valid_from", start: windowStart, end: args.runDate }),
    loadMembershipPages({ comp, field: "valid_to", start: windowStart, end: args.runDate }),
  ]);
  if (additionCandidates.error) return { data: null, error: additionCandidates.error };
  if (removalCandidates.error) return { data: null, error: removalCandidates.error };

  const eventIsrcs = [...new Set([...(additionCandidates.data ?? []), ...(removalCandidates.data ?? [])].map((row) => row.isrc))];
  if (!eventIsrcs.length) {
    return {
      data: { window_start: windowStart, window_end: args.runDate, flows: [], movements: [] },
      error: null,
    };
  }

  const allMemberships: MembershipRow[] = [];
  for (let index = 0; index < eventIsrcs.length; index += 150) {
    const result = await loadMembershipPages({ comp, isrcs: eventIsrcs.slice(index, index + 150) });
    if (result.error) return { data: null, error: result.error };
    allMemberships.push(...(result.data ?? []));
  }

  const playlistToLabel = new Map(args.playlists.map((playlist) => [playlist.playlist_key, playlist.label_key]));
  const labelNames = new Map(args.labels.map((label) => [label.label_key, label.display_name]));
  const intervalsByIsrc = mergeMembershipIntervals(allMemberships, playlistToLabel);
  const additions: Array<{ isrc: string; label_key: string; display_name: string; event_date: string }> = [];
  const removals: Array<{ isrc: string; label_key: string; display_name: string; event_date: string }> = [];
  for (const [isrc, intervals] of intervalsByIsrc) {
    for (const interval of intervals) {
      if (interval.start >= windowStart && interval.start <= args.runDate) {
        additions.push({
          isrc,
          label_key: interval.labelKey,
          display_name: labelNames.get(interval.labelKey) ?? interval.labelKey,
          event_date: interval.start,
        });
      }
      if (interval.end) {
        const exitDate = addDaysISO(interval.end, 1);
        if (exitDate >= windowStart && exitDate <= args.runDate) {
          removals.push({
            isrc,
            label_key: interval.labelKey,
            display_name: labelNames.get(interval.labelKey) ?? interval.labelKey,
            event_date: exitDate,
          });
        }
      }
    }
  }

  const trackMeta = new Map<
    string,
    { isrc: string; name: string; artist_names: string[] | null; album_image_url: string | null }
  >();
  for (let index = 0; index < eventIsrcs.length; index += 200) {
    const { data, error } = await comp
      .from("tracks")
      .select("isrc,name,spotify_artist_names,spotify_album_image_url")
      .in("isrc", eventIsrcs.slice(index, index + 200));
    if (error) return { data: null, error };
    for (const row of (data ?? []) as TrackMetaRow[]) {
      trackMeta.set(row.isrc, {
        isrc: row.isrc,
        name: row.name ?? row.isrc,
        artist_names: row.spotify_artist_names,
        album_image_url: row.spotify_album_image_url,
      });
    }
  }

  const built = buildRosterMovement(additions, removals, trackMeta);
  return {
    data: {
      window_start: windowStart,
      window_end: args.runDate,
      flows: built.flows,
      movements: built.movements.slice(0, 250),
    },
    error: null,
  };
}

async function loadCatalogInsights(args: {
  runDate: string;
  labels: LabelIdentity[];
}): Promise<{ data: CompetitorCatalogInsights | null; error: { message: string } | null }> {
  const comp = supabaseService().schema("competitor");
  const results = await Promise.all(
    args.labels.map(async (label) => ({
      label,
      result: await comp.rpc("home_track_scatter_points_for_label", {
        label_key: label.label_key,
        run_date: args.runDate,
        prev_date: addDaysISO(args.runDate, -1),
      }),
    })),
  );

  const points: CatalogTrackPoint[] = [];
  for (const { label, result } of results) {
    if (result.error) return { data: null, error: result.error };
    for (const row of (result.data ?? []) as ScatterRow[]) {
      points.push({
        isrc: String(row.isrc ?? ""),
        release_date: row.release_date?.slice(0, 10) ?? null,
        artist_ids: row.artist_ids,
        artist_names: row.artist_names,
        album_image_url: row.album_image_url,
        total_streams_cumulative: Number(row.total_streams_cumulative ?? 0),
        daily_streams_delta: Number(row.daily_streams_delta ?? 0),
        label_key: label.label_key,
      });
    }
  }

  const dataDate = dataDateFromRunDate(args.runDate);
  return { data: { data_date: dataDate, ...buildCatalogInsights(points, dataDate) }, error: null };
}

/**
 * Cached workspace insights for one scope. Exported so the post-ingestion
 * revalidation hook can warm the cache (these scopes fan out across every label
 * and take several seconds on a cold miss).
 */
export async function loadWorkspaceInsightsCached(args: {
  scope: "movement" | "catalog";
  runDate: string;
}) {
  const { scope, runDate } = args;
  const svc = supabaseService();
  const comp = svc.schema("competitor");
  const [{ data: playlistsRaw, error: playlistsError }, { data: labelsRaw, error: labelsError }] =
    await Promise.all([
      comp.from("playlists").select("playlist_key,label_key").eq("is_active", true),
      comp.from("labels").select("label_key,display_name,is_active").eq("is_active", true),
    ]);
  if (playlistsError) return { data: null, error: playlistsError };
  if (labelsError) return { data: null, error: labelsError };

  const playlists = (playlistsRaw ?? []) as PlaylistIdentity[];
  const labels = (labelsRaw ?? []) as LabelIdentity[];
  let overrideVersion = "0";
  if (scope === "catalog") {
    const versionResult = await comp.rpc("spotibase_override_version");
    if (!versionResult.error && typeof versionResult.data === "string") {
      overrideVersion = versionResult.data;
    }
  }
  const cacheKey = `competitor-workspace-insights-v1-${scope}-${runDate}-ov${overrideVersion}`;
  return cachedQuery<CompetitorMovementInsights | CompetitorCatalogInsights>(
    async () =>
      scope === "movement"
        ? await loadMovementInsights({ runDate, playlists, labels })
        : await loadCatalogInsights({ runDate, labels }),
    cacheKey,
    CACHE_TTL_1H,
  );
}
