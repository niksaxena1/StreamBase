import Link from "next/link";
import { redirect } from "next/navigation";
import { List } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { formatInt, formatDateISO } from "@/lib/format";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { TrackDashboardControls } from "@/components/dashboard/TrackDashboardControls";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { StatCard } from "@/components/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

export const revalidate = 86400; // 24h ISR - data updates daily

type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_artist_ids: string[] | null;
  spotify_artist_names: string[] | null;
  spotify_album_image_url: string | null;
};

type TrackDailyRow = {
  date: string;
  streams_cumulative: number | null;
};

function clampRangeDays(raw: string | undefined): number {
  const n = Number(raw ?? "90");
  if (n === 30 || n === 90 || n === 365) return n;
  return 90;
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + delta);
  return d.toISOString().split("T")[0]!;
}

function computeRollingAvg7(desc: Array<{ date: string; daily: number }>) {
  return desc.map((p, idx) => {
    const window = desc.slice(Math.max(0, idx - 6), idx + 1);
    const sum = window.reduce((acc, x) => acc + x.daily, 0);
    return { date: p.date, daily: p.daily, ma7: Math.round(sum / window.length) };
  });
}

function sumLastNDays(desc: Array<{ date: string; daily: number }>, days: number) {
  return desc.slice(0, days).reduce((acc, p) => acc + p.daily, 0);
}

async function fetchAllTrackSeries(
  sb: Awaited<ReturnType<typeof supabaseServer>>,
  args: { isrc: string; startDate: string; endDate: string; maxRows?: number },
) {
  const pageSize = 1000;
  const out: TrackDailyRow[] = [];
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

    const rows = (data ?? []) as TrackDailyRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

export default async function TracksPage({
  searchParams,
}: {
  // See note in other pages: keep this as `any` to satisfy Next's generated PageProps typing
  // while avoiding `await searchParams` (which breaks static generation in Next 16).
  searchParams?: any;
}) {
  try {
    const sp = (searchParams ?? {}) as { isrc?: string; range?: string; view?: string };
    
    // Backwards-compat: old query-driven list view
    if ((sp.view ?? "").trim().toLowerCase() === "list") {
      redirect("/tracks/config");
    }

    const rangeDays = clampRangeDays(sp.range);
    const sb = await supabaseServer();

    // Get all tracks for the selector (cached for 1 hour)
    const { data: allTracks } = await cachedQuery(
      async () =>
        await sb
          .from("tracks")
          .select("isrc,name")
          .not("name", "is", null)
          .order("last_seen", { ascending: false })
          .limit(1000),
      "tracks-list",
      3600,
    );

    const trackOptions = (allTracks ?? [])
      .map((t) => ({ isrc: t.isrc, name: t.name ?? t.isrc }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const firstTrackIsrc = trackOptions[0]?.isrc ?? null;

    const isrc = (sp.isrc ?? "").trim();
    if (!isrc) {
      return (
        <RememberParamRedirect
          param="isrc"
          storageKey="sb:last_track_isrc"
          defaultValue={firstTrackIsrc}
          loadingTitle="Opening your last track…"
          loadingSubtitle="If this is your first time, we'll pick the first track we find."
        />
      );
    }

    // Get track details (cached for 1 hour)
    const { data: track, error: trackError } = await cachedQuery(
      async () =>
        await sb
          .from("tracks")
          .select("isrc,name,spotify_artist_ids,spotify_artist_names,spotify_album_image_url")
          .eq("isrc", isrc)
          .maybeSingle(),
      `track-details-${isrc}`,
      3600,
    );

    if (trackError) {
      console.error("Error fetching track:", trackError);
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
            Error loading track data: {trackError.message}
          </div>
        </div>
      );
    }

    const trackRow = (track ?? null) as TrackRow | null;
    const trackName = trackRow?.name ?? isrc;

    // Canonical latest date (use all_catalog playlist stats as "ingestion day") - cached
    const { data: latestRun } = await cachedQuery(
      async () =>
        await sb
          .from("playlist_daily_stats")
          .select("date")
          .eq("playlist_key", "all_catalog")
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      "latest-date-all-catalog",
      3600,
    );

    const latestDate = (latestRun as { date: string } | null)?.date ?? null;
    const startDate = latestDate ? addDays(latestDate, -rangeDays) : null;

    // Fetch track series
    const trackSeries =
      latestDate && startDate
        ? await fetchAllTrackSeries(sb, { isrc, startDate, endDate: latestDate, maxRows: 5000 })
        : ([] as Array<{ date: string; streams_cumulative: number | null }>);

    const trackCumDesc = (trackSeries ?? []).map((r) => ({
      date: r.date,
      value: Number(r.streams_cumulative ?? 0),
    }));
    const trackCumAsc = [...trackCumDesc].reverse();
    const trackDailyAsc = trackCumAsc.map((p, idx) => {
      if (idx === 0) return { date: p.date, daily: 0 };
      const prev = trackCumAsc[idx - 1].value;
      return { date: p.date, daily: Math.max(0, p.value - prev) };
    });
    const trackDailyDesc = [...trackDailyAsc].reverse();
    const trackDailyWithMaDesc = computeRollingAvg7(trackDailyDesc);
    const track24h = trackDailyDesc[0]?.daily ?? 0;
    const track7d = sumLastNDays(trackDailyDesc, 7);
    const track28d = sumLastNDays(trackDailyDesc, 28);
    const track30d = sumLastNDays(trackDailyDesc, 30);

    const latestCum = trackCumDesc.length ? trackCumDesc[trackCumDesc.length - 1].value : 0;
    const prevCum = trackCumDesc.length > 1 ? trackCumDesc[trackCumDesc.length - 2].value : 0;
    const dailyGrowth = latestCum - prevCum;

    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Dashboard / Tracks
            </div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                {trackName}
              </h1>
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              ISRC: <span className="font-mono">{isrc}</span>
              {trackRow?.spotify_artist_names?.length ? (
                <>
                  {" "}
                  • Artists:{" "}
                  <ArtistLinks
                    artistNames={trackRow.spotify_artist_names}
                    artistIds={trackRow.spotify_artist_ids ?? undefined}
                  />
                </>
              ) : null}
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              {latestDate ? (
                <>
                  Latest snapshot: <span className="font-mono">{formatDateISO(latestDate)}</span>
                </>
              ) : (
                "No stats found for this track yet."
              )}
            </div>
          </div>
          <Link
            href="/tracks/config"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Track config"
            title="Track config"
          >
            <List className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
        </div>

        <TrackDashboardControls
          tracks={trackOptions}
          isrc={isrc}
          rangeDays={rangeDays}
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <StatCard
            title="24h"
            value={<AnimatedCounter value={track24h} />}
            subtitle="Net streams"
            trendData={trackDailyDesc.slice(0, 7).map((p) => p.daily)}
          />
          <StatCard
            title="7d"
            value={<AnimatedCounter value={track7d} />}
            subtitle="Net streams"
            trendData={trackDailyDesc.slice(0, 7).map((p) => p.daily)}
          />
          <StatCard
            title="28d"
            value={<AnimatedCounter value={track28d} />}
            subtitle="Net streams"
            trendData={trackDailyDesc.slice(0, 28).map((p) => p.daily)}
          />
          <StatCard
            title="30d"
            value={<AnimatedCounter value={track30d} />}
            subtitle="Net streams"
            trendData={trackDailyDesc.slice(0, 30).map((p) => p.daily)}
          />

          <SpotlightCard className="lg:col-span-8 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Track cumulative streams
            </div>
            <div className="mt-2 min-h-[180px]">
              <DailyStreamsChart
                data={trackCumDesc}
                valueLabel="Total streams"
                valueFormat="int"
                yTickFormat="k"
                heightPx={220}
                isCumulative={true}
              />
            </div>
          </SpotlightCard>

          <SpotlightCard className="lg:col-span-4 p-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Track daily streams (MA7)
            </div>
            <div className="mt-2 min-h-[180px]">
              <DailyStreamsWithMAChart
                data={trackDailyWithMaDesc}
                valueLabel="Daily streams"
                valueFormat="int"
                yTickFormat="k"
                heightPx={220}
              />
            </div>
          </SpotlightCard>
        </div>
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
    console.error("Error in TracksPage:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          <h2 className="font-semibold">Error loading track page</h2>
          <p className="mt-1">{errorMessage}</p>
        </div>
      </div>
    );
  }
}
