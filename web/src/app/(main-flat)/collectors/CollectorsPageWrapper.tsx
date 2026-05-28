"use client";

import { useSharedGranularity } from "@/lib/useSharedGranularity";
import { CollectorsPageHeader } from "./CollectorsPageHeader";
import { CollectorsClient } from "./CollectorsClient";
import type { CollectorDailyData } from "@/components/charts/CollectorComparisonChart";
import type {
  CollectorOverlapArtistCell,
  CollectorOverlapCell,
  CollectorSeriesPoint,
  CollectorSummaryRow,
  TopPlaylistRow,
} from "./collectorsTypes";

export function CollectorsPageWrapper(props: {
  selectedCollector: string;
  rangeDays: number;
  latestDataDate: string | null;
  latestDate: string | null;
  latestRunDate: string;
  useEntityPlaylistsForTotals: boolean;
  overlapCells: CollectorOverlapCell[];
  overlapArtistCells: CollectorOverlapArtistCell[];
  summary: CollectorSummaryRow[];
  seriesDesc: CollectorSeriesPoint[];
  seriesAllTime: CollectorSeriesPoint[];
  topPlaylists: TopPlaylistRow[];
  selectedPlaylistsMeta: Array<{
    playlist_key: string;
    display_name: string;
    spotify_playlist_image_url: string | null;
  }>;
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
        useEntityPlaylistsForTotals={props.useEntityPlaylistsForTotals}
        overlapCells={props.overlapCells}
        overlapArtistCells={props.overlapArtistCells}
        selectedCollector={props.selectedCollector}
        rangeDays={props.rangeDays}
        granularity={granularity}
        summary={props.summary}
        seriesDesc={props.seriesDesc}
        seriesAllTime={props.seriesAllTime}
        topPlaylists={props.topPlaylists}
        selectedPlaylistsMeta={props.selectedPlaylistsMeta}
        allCollectorsSeries={props.allCollectorsSeries}
        allCollectorsAllTime={props.allCollectorsAllTime}
      />
    </div>
  );
}
