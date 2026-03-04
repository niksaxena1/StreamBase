import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";
import { CACHE_TTL_1H, HOME_SCATTER_HARD_CAP } from "@/lib/constants";
import { addDaysISO, SOT_DATA_LAG_DAYS, dataDateFromRunDate } from "@/lib/sotDates";
import { HomeScatterSection } from "./home/HomeScatterSection";
import { HomeMilestonesSection } from "./home/HomeMilestonesSection";
import { HomeDailyDistributionSection } from "./home/HomeDailyDistributionSection";
import { HomeWeekendDipsSection } from "./home/HomeWeekendDipsSection";
import { HomeFilterBuilderSection } from "./home/HomeFilterBuilderSection";
import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import type { ArtistWeekendDipRow, TrackWeekendDipRow } from "./home/homeTypes";

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

async function fetchTrackScatterPoints(
  svc: ReturnType<typeof supabaseService>,
  args: { runDate: string; prevDate: string },
) {
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

export async function HomeScatterFetcher({
  latestRunDate,
  prevDate,
  latestDataDate,
  userId,
}: {
  latestRunDate: string | null;
  prevDate: string | null;
  latestDataDate: string | null;
  userId: string;
}) {
  const svc = supabaseService();

  let trackScatterPoints: TrackStreamsXYPoint[] = [];
  let trackScatterErr: Error | null = null;

  // Fetch scatter points
  const scatterCacheKey = `home-track-scatter-v7-${latestRunDate ?? "none"}`;
  try {
    const { data } = await cachedQuery(
      async () => {
        if (!latestRunDate) return { data: [] as TrackStreamsXYPoint[], error: null };

        const prevRunDateCalculated = addDaysIso(latestRunDate, -1);
        const rows = await fetchTrackScatterPoints(svc, {
          runDate: latestRunDate,
          prevDate: prevRunDateCalculated,
        });

        return {
          data: (rows.map((r) => ({
            isrc: String(r?.isrc ?? "").trim(),
            name: String(r?.name ?? "").trim() || null,
            streams_today: Number(r?.streams_today ?? 0) || 0,
            streams_yesterday: Number(r?.streams_yesterday ?? 0) || 0,
            streams_delta: Number(r?.streams_delta ?? 0) || 0,
          })) as TrackStreamsXYPoint[]),
          error: null,
        };
      },
      scatterCacheKey,
      CACHE_TTL_1H,
    );

    trackScatterPoints = data ?? [];
  } catch (e) {
    trackScatterErr = e instanceof Error ? e : new Error(String(e));
  }

  // Fetch weekend dips and negative streams in parallel
  const [{ data: artistWeekendDips }, { data: trackWeekendDips }] = await Promise.all([
    cachedQuery(
      async () => {
        return await svc.rpc("home_artist_weekend_dips", {
          p_min_weekday_avg: 0,
          p_anchor_data_date: latestDataDate ?? null,
        });
      },
      `home-artist-weekend-dips-all_catalog-${latestDataDate ?? "none"}-${userId}`,
      CACHE_TTL_1H,
    ),
    cachedQuery(
      async () => {
        return await svc.rpc("home_track_weekend_dips", {
          p_min_weekday_avg: 0,
          p_anchor_data_date: latestDataDate ?? null,
        });
      },
      `home-track-weekend-dips-all_catalog-${latestDataDate ?? "none"}-${userId}`,
      CACHE_TTL_1H,
    ),
  ]);

  const trackScatterDataDate = latestDataDate;

  return (
    <>
      <HomeScatterSection
        trackScatterPoints={trackScatterPoints}
        trackScatterErrorMessage={trackScatterErr?.message ?? null}
      />
      <HomeMilestonesSection trackScatterPoints={trackScatterPoints} />
      <HomeDailyDistributionSection trackScatterPoints={trackScatterPoints} />
      <HomeWeekendDipsSection
        artistWeekendDips={(artistWeekendDips as ArtistWeekendDipRow[] | null) ?? []}
        trackWeekendDips={(trackWeekendDips as TrackWeekendDipRow[] | null) ?? []}
      />
      <HomeFilterBuilderSection
        trackScatterPoints={trackScatterPoints}
        trackScatterDataDate={trackScatterDataDate}
      />
    </>
  );
}
