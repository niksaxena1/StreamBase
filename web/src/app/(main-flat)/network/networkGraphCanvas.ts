import type { ForceGraphMethods } from "react-force-graph-2d";
import {
  NETWORK_GRID_MAX_LINES_PER_AXIS,
  NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS,
  NETWORK_GRID_MINOR_MAX_PX,
  NETWORK_GRID_MINOR_MIN_PX,
  NETWORK_GRID_TARGET_PX,
} from "./networkGraphConstants";
import { nearGridMultiple, pickNiceGridStep, scaleLinear, type FGNodeObj } from "./networkGraphPure";
import type { GraphEdge, GraphNode } from "./networkTypes";

/**
 * World-space grid (pans/zooms with the graph) for spatial reference while navigating.
 * Drawn from `onRenderFramePre` once the graph and a non-trivial `w`×`h` viewport exist.
 */
export function drawNetworkBackgroundGrid(
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  fg: Pick<ForceGraphMethods<GraphNode, GraphEdge>, "screen2GraphCoords">,
  w: number,
  h: number,
  isDark: boolean,
) {
  let tl: { x: number; y: number };
  let br: { x: number; y: number };
  try {
    tl = fg.screen2GraphCoords(0, 0);
    br = fg.screen2GraphCoords(w, h);
  } catch {
    return;
  }

  let minX = Math.min(tl.x, br.x);
  let maxX = Math.max(tl.x, br.x);
  let minY = Math.min(tl.y, br.y);
  let maxY = Math.max(tl.y, br.y);

  let step = pickNiceGridStep(NETWORK_GRID_TARGET_PX / globalScale);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  for (let i = 0; i < 24; i++) {
    if (
      !(spanX > 0 && spanX / step > NETWORK_GRID_MAX_LINES_PER_AXIS) &&
      !(spanY > 0 && spanY / step > NETWORK_GRID_MAX_LINES_PER_AXIS)
    ) {
      break;
    }
    step *= 2;
  }
  for (let i = 0; i < 24; i++) {
    if (!(spanX > 0 && spanY > 0 && spanX / step < 5 && spanY / step < 5)) break;
    step /= 2;
  }
  step = Math.max(step, 1e-8);

  const pad = step;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;

  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;
  const eps = step * 1e-9;

  const baseAlpha = isDark ? 0.055 : 0.048;
  const zoomBoost = Math.min(1.2, Math.max(0.58, 0.58 + globalScale * 0.14));
  const majorAlpha = Math.min(0.085, baseAlpha * zoomBoost);
  const majorStroke = isDark
    ? `rgba(255,255,255,${majorAlpha})`
    : `rgba(0,0,0,${majorAlpha})`;

  const hairline = Math.max(0.55 / globalScale, 0.0008);

  ctx.save();
  ctx.lineCap = "square";

  const sub = step / 5;
  const minorPx = sub * globalScale;
  const estMinorX = spanX / sub;
  const estMinorY = spanY / sub;
  const drawMinor =
    minorPx >= NETWORK_GRID_MINOR_MIN_PX &&
    minorPx <= NETWORK_GRID_MINOR_MAX_PX &&
    estMinorX <= NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS &&
    estMinorY <= NETWORK_GRID_MINOR_MAX_LINES_PER_AXIS;

  if (drawMinor) {
    const minorAlpha = majorAlpha * 0.38;
    const minorStroke = isDark
      ? `rgba(255,255,255,${minorAlpha})`
      : `rgba(0,0,0,${minorAlpha})`;
    const subStartX = Math.floor(minX / sub) * sub;
    const subStartY = Math.floor(minY / sub) * sub;
    const subEps = sub * 1e-9;
    const dash = Math.max(2.2 / globalScale, 0.001);

    ctx.strokeStyle = minorStroke;
    ctx.lineWidth = Math.max(0.48 / globalScale, 0.0006);
    ctx.setLineDash([dash, dash * 1.15]);

    ctx.beginPath();
    for (let gx = subStartX; gx <= maxX + subEps; gx += sub) {
      if (nearGridMultiple(gx, step)) continue;
      ctx.moveTo(gx, minY);
      ctx.lineTo(gx, maxY);
    }
    ctx.stroke();

    ctx.beginPath();
    for (let gy = subStartY; gy <= maxY + subEps; gy += sub) {
      if (nearGridMultiple(gy, step)) continue;
      ctx.moveTo(minX, gy);
      ctx.lineTo(maxX, gy);
    }
    ctx.stroke();

    ctx.setLineDash([]);
  }

  ctx.strokeStyle = majorStroke;
  ctx.lineWidth = hairline;

  ctx.beginPath();
  for (let gx = startX; gx <= maxX + eps; gx += step) {
    ctx.moveTo(gx, minY);
    ctx.lineTo(gx, maxY);
  }
  ctx.stroke();

  ctx.beginPath();
  for (let gy = startY; gy <= maxY + eps; gy += step) {
    ctx.moveTo(minX, gy);
    ctx.lineTo(maxX, gy);
  }
  ctx.stroke();

  const originAlpha = Math.min(0.11, majorAlpha * 1.55);
  const originStroke = isDark
    ? `rgba(255,255,255,${originAlpha})`
    : `rgba(0,0,0,${originAlpha})`;
  ctx.strokeStyle = originStroke;
  ctx.lineWidth = Math.max(0.72 / globalScale, 0.001);

  if (minX <= 0 && maxX >= 0) {
    ctx.beginPath();
    ctx.moveTo(0, minY);
    ctx.lineTo(0, maxY);
    ctx.stroke();
  }
  if (minY <= 0 && maxY >= 0) {
    ctx.beginPath();
    ctx.moveTo(minX, 0);
    ctx.lineTo(maxX, 0);
    ctx.stroke();
  }

  ctx.restore();
}

/** Screen hit-test aligned with `nodePointerAreaPaint` (touch long-press → distro modal). */
export function pickNetworkNodeAtClientPos(
  fg: Pick<ForceGraphMethods<GraphNode, GraphEdge>, "zoom" | "graph2ScreenCoords">,
  host: HTMLElement,
  clientX: number,
  clientY: number,
  view: {
    width: number;
    height: number;
    nodes: FGNodeObj[];
    scaleByTracks: boolean;
    minTrackCount: number;
    maxTrackCount: number;
  },
): FGNodeObj | null {
  const { width, height, nodes, scaleByTracks, minTrackCount, maxTrackCount } = view;
  const r = host.getBoundingClientRect();
  const px = clientX - r.left;
  const py = clientY - r.top;
  if (px < 0 || py < 0 || px > width || py > height) return null;
  let k: number;
  try {
    k = fg.zoom();
  } catch {
    return null;
  }
  if (!Number.isFinite(k) || k < 0.001) return null;

  let best: FGNodeObj | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const nx = n.x;
    const ny = n.y;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
    const gx = nx as number;
    const gy = ny as number;
    const baseSize = scaleByTracks
      ? scaleLinear(n.track_count ?? 1, minTrackCount, maxTrackCount, 3, 16)
      : 5;
    const hitSize = Math.max(baseSize, 6);
    const hitR = hitSize * k;
    let scr: { x: number; y: number };
    try {
      scr = fg.graph2ScreenCoords(gx, gy);
    } catch {
      continue;
    }
    const dx = px - scr.x;
    const dy = py - scr.y;
    const d = Math.hypot(dx, dy);
    if (d <= hitR && d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}
