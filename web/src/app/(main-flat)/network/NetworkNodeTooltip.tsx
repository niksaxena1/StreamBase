"use client";

import type { ThemeColors } from "@/components/charts/useThemeColors";
import { trackScopedCoartistCount } from "./networkGraphPure";
import type { CollabCountBasis } from "./networkGraphTypes";
import type { GraphNode } from "./networkTypes";

/** Hover tooltip for an artist node: track count, co-artist count (both bases) and graph degree. */
export function NetworkNodeTooltipContent({
  node: n,
  trackCollabFilterMap,
  graphDegreeMap,
  collabCountBasis,
  hideNonPrimary,
  colors,
}: {
  node: GraphNode;
  trackCollabFilterMap: Map<string, number>;
  graphDegreeMap: Map<string, number>;
  collabCountBasis: CollabCountBasis;
  hideNonPrimary: boolean;
  colors: ThemeColors;
}) {
  const id = n.id as string;
  const coTracks = trackCollabFilterMap.get(id) ?? trackScopedCoartistCount(n, collabCountBasis);
  const gDeg = graphDegreeMap.get(id) ?? 0;
  const coOther =
    collabCountBasis === "playlist"
      ? trackScopedCoartistCount(n, "primary_rows")
      : trackScopedCoartistCount(n, "playlist");
  return (
    <div className="space-y-1">
      <div className="font-semibold text-sm" style={{ color: colors.accent }}>
        {n.name}
      </div>
      <div className="text-xs" style={{ color: colors.muted }}>
        {n.track_count} track{n.track_count !== 1 ? "s" : ""} &middot;{" "}
        {coTracks} co-artist{coTracks !== 1 ? "s" : ""}{" "}
        {collabCountBasis === "playlist" ? "(playlist-wide)" : "(primary rows only)"}
      </div>
      {coOther !== coTracks ? (
        <div className="text-[10px] leading-snug" style={{ color: colors.muted }}>
          Other basis: {coOther}
        </div>
      ) : null}
      {hideNonPrimary && gDeg !== coTracks ? (
        <div className="text-[10px] leading-snug" style={{ color: colors.muted }}>
          Graph links: {gDeg} (edges only between artists who are both primary somewhere in scope)
        </div>
      ) : null}
    </div>
  );
}
