"use client";

import { useCallback } from "react";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import { getImage } from "./networkGraphImageCache";
import {
  accentRgba,
  collaborationLinkKey,
  type FGLinkObj,
  type FGNodeObj,
} from "./networkGraphPure";
import type { GraphEdge } from "./networkTypes";
import { collaborationIsRecent, streamEdgeWidth } from "./networkInsights";

/**
 * ForceGraph2D paint callbacks: node size, node canvas drawing, pointer hit area, link width and
 * link color. Focus / selection state is owned by the caller and passed in.
 */
export function useNetworkGraphPainters({
  nodeRadius,
  nodeClusterColor,
  sizeByStreams,
  maxEdgeStreams,
  highlightRecent,
  appearanceByKey,
  todayDay,
  showImages,
  selectedNodeId,
  hoveredNode,
  hoveredLink,
  pinnedLink,
  rangeSet,
  isHighlighted,
  isLinkHighlighted,
  colors,
}: {
  nodeRadius: (node: FGNodeObj) => number;
  nodeClusterColor: (id: string) => string | null;
  sizeByStreams: boolean;
  maxEdgeStreams: number;
  highlightRecent: boolean;
  appearanceByKey: Map<string, number | null>;
  todayDay: number;
  showImages: boolean;
  selectedNodeId: string | null;
  hoveredNode: FGNodeObj | null;
  hoveredLink: FGLinkObj | null;
  pinnedLink: FGLinkObj | null;
  rangeSet: Set<string>;
  isHighlighted: (nodeId: string) => boolean;
  isLinkHighlighted: (link: FGLinkObj) => boolean;
  colors: ThemeColors;
}) {
  /* -------- Node rendering -------- */

  const nodeVal = useCallback(() => 2, []);

  const nodeCanvasObject = useCallback(
    (node: FGNodeObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const id = node.id as string;
      const highlighted = isHighlighted(id);
      const alpha = highlighted ? 1 : 0.12;
      const inRange = rangeSet.size > 0 && rangeSet.has(id);

      const size = nodeRadius(node);
      const cluster = nodeClusterColor(id);

      const x = node.x ?? 0;
      const y = node.y ?? 0;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Draw image or circle
      const img = showImages && node.image_url ? getImage(node.image_url) : null;
      if (img) {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x - size, y - size, size * 2, size * 2);
        // Border ring
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.strokeStyle = cluster ?? colors.accent;
        ctx.lineWidth = (cluster ? 3 : 1.2) / globalScale;
        ctx.stroke();
      } else {
        // Solid circle
        ctx.beginPath();
        ctx.arc(x, y, size, 0, 2 * Math.PI);
        ctx.fillStyle =
          cluster ?? (id === selectedNodeId || inRange ? colors.accent : colors.accentStroke);
        ctx.fill();

        // Subtle glow for selected
        if (id === selectedNodeId || inRange) {
          ctx.shadowColor = colors.accent;
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      if (inRange) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, size + 2.5 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Label (show when zoomed in or when highlighted)
      const showLabel =
        globalScale > 1.8 ||
        id === selectedNodeId ||
        inRange ||
        id === (hoveredNode?.id as string);
      if (showLabel && highlighted) {
        const label = node.name ?? id;
        const fontSize = Math.max(10 / globalScale, 2);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = colors.text;
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillText(label, x, y + size + 2 / globalScale);
      }

      ctx.restore();
    },
    [
      isHighlighted,
      nodeRadius,
      nodeClusterColor,
      showImages,
      selectedNodeId,
      hoveredNode,
      colors,
      rangeSet,
    ],
  );

  // Hit area for pointer
  const nodePointerAreaPaint = useCallback(
    (node: FGNodeObj, color: string, ctx: CanvasRenderingContext2D) => {
      const size = nodeRadius(node);
      const hitSize = Math.max(size, 6);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, hitSize, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [nodeRadius],
  );

  /* -------- Link rendering -------- */

  const linkWidth = useCallback(
    (link: FGLinkObj) => {
      const w = (link as unknown as GraphEdge).weight ?? 1;
      let width = sizeByStreams ? streamEdgeWidth(link.daily_streams, maxEdgeStreams, w) : 0.8;
      const key = collaborationLinkKey(link);
      const hoverOrPin =
        (hoveredLink != null && collaborationLinkKey(hoveredLink) === key) ||
        (pinnedLink != null && collaborationLinkKey(pinnedLink) === key);
      if (hoverOrPin) width = Math.min(width + 1.25, 8);
      return width;
    },
    [hoveredLink, pinnedLink, sizeByStreams, maxEdgeStreams],
  );

  const linkColor = useCallback(
    (link: FGLinkObj) => {
      const hl = isLinkHighlighted(link);
      if (!hl) return colors.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
      const w = (link as unknown as GraphEdge).weight ?? 1;
      let a = Math.min(0.15 + w * 0.1, 0.6);
      const key = collaborationLinkKey(link);
      if (highlightRecent) a = collaborationIsRecent(appearanceByKey.get(key) ?? null, todayDay) ? 0.85 : 0.045;
      const isHover =
        hoveredLink != null && collaborationLinkKey(hoveredLink) === key;
      const isPinned =
        pinnedLink != null && collaborationLinkKey(pinnedLink) === key;
      // Brighter stroke for interactive focus: hover preview or frozen tooltip anchor.
      if (isHover || isPinned) {
        a = Math.min(a + 0.24, 0.92);
      }
      return accentRgba(colors.accent, a);
    },
    [isLinkHighlighted, colors, hoveredLink, pinnedLink, highlightRecent, appearanceByKey, todayDay],
  );

  return { nodeVal, nodeCanvasObject, nodePointerAreaPaint, linkWidth, linkColor };
}
