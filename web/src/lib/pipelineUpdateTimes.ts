// ops.pipeline_config.refresh_after: own 12:00 UTC, competitor 12:16 UTC.
// Display the configured daily start times in GMT+4.
export const PIPELINE_UPDATE_TIMES = {
  own: { starts: "16:00" },
  competitor: { starts: "16:16" },
} as const;

export function pipelineUpdateTooltip(datasetMode: keyof typeof PIPELINE_UPDATE_TIMES): string {
  const times = PIPELINE_UPDATE_TIMES[datasetMode];
  return `Next update starts ${times.starts} GMT+4 (daily, automatic).`;
}
