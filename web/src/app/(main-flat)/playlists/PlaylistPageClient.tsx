"use client";

import { PlaylistMetricsClient } from "./PlaylistMetricsClient";
import { useMetric } from "@/components/metrics/MetricContext";
import { useSharedGranularity } from "@/lib/useSharedGranularity";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
};

export function PlaylistPageClient(props: {
  latest: PlaylistDailyStatsRow | null;
  latestDate: string | null;
  rangeDays: number;
  history: PlaylistDailyStatsRow[];
  removedTracksCount: number;
  playlistKey: string;
  overrideAnnotations: Array<{ date: string; note: string }>;
}) {
  const { metric } = useMetric();
  const [granularity] = useSharedGranularity("sb:playlists:granularity");

  return (
    <PlaylistMetricsClient
      latest={props.latest}
      latestDate={props.latestDate}
      rangeDays={props.rangeDays}
      history={props.history}
      removedTracksCount={props.removedTracksCount}
      playlistKey={props.playlistKey}
      overrideAnnotations={props.overrideAnnotations}
      metric={metric}
      granularity={granularity}
    />
  );
}
