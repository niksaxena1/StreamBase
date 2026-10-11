// ops.pipeline_config.refresh_after: own 05:07 UTC, competitor 05:23 UTC.
// Display the configured daily start times in GMT+4.
export const PIPELINE_UPDATE_TIMES = {
  own: { starts: "09:07" },
  competitor: { starts: "09:23" },
} as const;

export function pipelineUpdateTooltip(datasetMode: keyof typeof PIPELINE_UPDATE_TIMES): string {
  const times = PIPELINE_UPDATE_TIMES[datasetMode];
  return `Next update starts ${times.starts} GMT+4 (daily, automatic).`;
}
