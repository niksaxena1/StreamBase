"use client";

import { PlaylistMetricSelector } from "./PlaylistMetricSelector";
import { usePlaylistMetric } from "./PlaylistMetricContext";

export function PlaylistHeaderWithSelector() {
  const { metric, setMetric } = usePlaylistMetric();
  return <PlaylistMetricSelector metric={metric} setMetric={setMetric} />;
}
