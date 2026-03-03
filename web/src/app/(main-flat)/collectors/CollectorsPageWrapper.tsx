"use client";

import { useSharedGranularity } from "@/lib/useSharedGranularity";
import { CollectorsPageHeader } from "./CollectorsPageHeader";
import { CollectorsClient } from "./CollectorsClient";
import type { CollectorDailyData } from "@/components/charts/CollectorComparisonChart";
import type { CollectorSeriesPoint, CollectorTrackRow, CollectorSummaryRow, TopPlaylistRow } from "./collectorsTypes";

export function CollectorsPageWrapper(props: {
  selectedCollector: string;
  rangeDays: number;
  latestDataDate: string | null;
  latestDate: string | null;
  latestRunDate: string;
  summary: CollectorSummaryRow[];
  seriesDesc: CollectorSeriesPoint[];
  seriesAllTime: CollectorSeriesPoint[];
  topPlaylists: TopPlaylistRow[];
  selectedPlaylistsMeta: Array<{
    playlist_key: string;
    display_name: string;
    spotify_playlist_image_url: string | null;
  }>;
  collectorTracks: CollectorTrackRow[];
  allCollectorsSeries: CollectorDailyData[];
  allCollectorsAllTime: CollectorDailyData[];
}) {
  const [granularity, setGranularity] = useSharedGranularity("sb:collectors:granularity");

  return (
    <div className="space-y-4">
      <CollectorsPageHeader
        selectedCollector={props.selectedCollector}
        rangeDays={props.rangeDays}
        latestDataDate={props.latestDataDate}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />
      <CollectorsClient
        latestDate={props.latestDate}
        latestRunDate={props.latestRunDate}
        selectedCollector={props.selectedCollector}
        rangeDays={props.rangeDays}
        granularity={granularity}
        summary={props.summary}
        seriesDesc={props.seriesDesc}
        seriesAllTime={props.seriesAllTime}
        topPlaylists={props.topPlaylists}
        selectedPlaylistsMeta={props.selectedPlaylistsMeta}
        collectorTracks={props.collectorTracks}
        allCollectorsSeries={props.allCollectorsSeries}
        allCollectorsAllTime={props.allCollectorsAllTime}
      />
    </div>
  );
}
