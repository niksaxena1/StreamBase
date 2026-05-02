import { formatCompactMoney, formatUsd2 } from "@/lib/format";

export function formatSearchStreamsStat(streams: number) {
  if (streams >= 1_000_000) return `${(streams / 1_000_000).toFixed(1)}M`;
  if (streams >= 1_000) return `${(streams / 1_000).toFixed(1)}K`;
  return String(streams);
}

export function formatSearchRevenueStat(revenueUsd: number) {
  return formatCompactMoney(revenueUsd, formatUsd2);
}

export function formatSearchHoverStat(
  metric: string,
  streams: number,
  streamPayoutPerStreamUsd: number,
) {
  return metric === "revenue"
    ? formatSearchRevenueStat(streams * streamPayoutPerStreamUsd)
    : formatSearchStreamsStat(streams);
}
