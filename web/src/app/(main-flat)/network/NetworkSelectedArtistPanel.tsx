"use client";

import type { ReactNode } from "react";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import type { GraphEdge, GraphNode } from "./page";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import type { CollabCountBasis } from "./networkGraphTypes";

export function ToggleButton({
  active,
  onClick,
  icon,
  title,
  colors,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  colors: ThemeColors;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors"
      style={{
        color: active ? colors.accent : colors.muted,
        backgroundColor: active
          ? colors.isDark
            ? "rgba(212,255,77,0.12)"
            : "rgba(168,214,46,0.15)"
          : colors.isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(0,0,0,0.04)",
      }}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function SelectedArtistPanel({
  nodeId,
  nodes,
  edges,
  neighbors,
  coArtistsOnTracks,
  graphNeighborCount,
  collabCountBasis,
  hideNonPrimary,
  colors,
  onClose,
  onFocusArtist,
}: {
  nodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  neighbors: Map<string, Set<string>>;
  coArtistsOnTracks: number;
  graphNeighborCount: number;
  collabCountBasis: CollabCountBasis;
  hideNonPrimary: boolean;
  colors: ThemeColors;
  onClose: () => void;
  onFocusArtist: (id: string) => void;
}) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const neighborIds = neighbors.get(nodeId) ?? new Set();
  const neighborNodes = nodes.filter((n) => neighborIds.has(n.id));
  neighborNodes.sort((a, b) => {
    // Sort by shared track count descending
    const aEdge = edges.find(
      (e) =>
        (e.source === nodeId && e.target === a.id) ||
        (e.target === nodeId && e.source === a.id),
    );
    const bEdge = edges.find(
      (e) =>
        (e.source === nodeId && e.target === b.id) ||
        (e.target === nodeId && e.source === b.id),
    );
    return (bEdge?.weight ?? 0) - (aEdge?.weight ?? 0);
  });

  const relatedEdges = edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  );
  const totalSharedTracks = relatedEdges.reduce((sum, e) => sum + e.weight, 0);

  return (
    <div
      className="flex items-start gap-3 px-4 py-2.5 border-b overflow-x-auto"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.isDark ? "rgba(212,255,77,0.04)" : "rgba(168,214,46,0.06)",
      }}
    >
      {/* Artist image */}
      {node.image_url ? (
        <PreviewableArtwork
          src={node.image_url}
          alt=""
          width={40}
          height={40}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0 mt-0.5"
          label={node.name}
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: colors.accent + "30" }}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate" style={{ color: colors.text }}>
            {node.name}
          </span>
          <span className="text-xs flex-shrink-0" style={{ color: colors.muted }}>
            {node.track_count} tracks &middot; {coArtistsOnTracks} co-artist{coArtistsOnTracks !== 1 ? "s" : ""}{" "}
            {collabCountBasis === "playlist" ? "(playlist-wide)" : "(lead rows)"} &middot; {graphNeighborCount} graph
            neighbor{graphNeighborCount !== 1 ? "s" : ""} &middot; {totalSharedTracks} shared tracks
          </span>
          <button
            className="ml-auto text-xs px-2 py-0.5 rounded flex-shrink-0"
            style={{ color: colors.muted }}
            onClick={onClose}
          >
            &times;
          </button>
        </div>

        {coArtistsOnTracks > 0 && neighborNodes.length === 0 && hideNonPrimary ? (
          <div className="text-xs mt-1.5 max-w-xl" style={{ color: colors.muted }}>
            Co-artists on your tracks are not shown below because the graph only links artists who are both primary on
            some track in this playlist.
          </div>
        ) : null}

        {/* Graph-linked collaborators (subset of co-artists when Hide non-primary) */}
        {neighborNodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {neighborNodes.slice(0, 20).map((nb) => {
              const edge = relatedEdges.find(
                (e) =>
                  (e.source === nodeId && e.target === nb.id) ||
                  (e.target === nodeId && e.source === nb.id),
              );
              return (
                <button
                  key={nb.id}
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors hover:brightness-125"
                  style={{
                    backgroundColor: colors.isDark
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(0,0,0,0.06)",
                    color: colors.text,
                  }}
                  onClick={() => onFocusArtist(nb.id)}
                >
                  {nb.image_url ? (
                    <PreviewableArtwork
                      src={nb.image_url}
                      alt=""
                      width={16}
                      height={16}
                      className="w-4 h-4 rounded-full object-cover"
                      interactive="inline"
                      label={nb.name}
                    />
                  ) : null}
                  <span className="truncate max-w-[120px]">{nb.name}</span>
                  {edge && edge.weight > 1 && (
                    <span style={{ color: colors.accent }} className="font-mono text-[10px]">
                      {edge.weight}
                    </span>
                  )}
                </button>
              );
            })}
            {neighborNodes.length > 20 && (
              <span className="text-xs px-2 py-0.5" style={{ color: colors.muted }}>
                +{neighborNodes.length - 20} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
