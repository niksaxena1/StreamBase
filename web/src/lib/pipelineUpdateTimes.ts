// ops.pipeline_config.refresh_after: own 05:07 UTC, competitor 05:23 UTC.
// Display in GMT+4; arrival times are estimates, not pipeline deadlines.
export const PIPELINE_UPDATE_TIMES = {
  own: { starts: "09:07", usuallyBy: "10:00" },
  competitor: { starts: "09:23", usuallyBy: "10:15" },
} as const;

export function pipelineUpdateTooltip(datasetMode: keyof typeof PIPELINE_UPDATE_TIMES): string {
  const times = PIPELINE_UPDATE_TIMES[datasetMode];
  return `Next update starts ${times.starts} GMT+4 (daily, automatic). New data usually appears by ~${times.usuallyBy}.`;
}
