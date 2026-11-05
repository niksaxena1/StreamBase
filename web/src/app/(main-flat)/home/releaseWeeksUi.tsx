"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "@/components/shell/RouteLink";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatInt } from "@/lib/format";
import { prettyDate, type ReleaseWeekTrack } from "./releaseWeeks";

export const num = "tabular-nums";
export const childRowClass = "bg-black/[0.02] dark:bg-white/[0.025]";

export function tone(pct: number | null): string {
  if (pct == null) return "#3b82f6";
  if (pct <= -0.15) return "#ef4444";
  if (pct <= -0.05) return "#f97316";
  if (pct >= 0.05) return "#22c55e";
  return "var(--sb-muted)";
}
export function pctText(pct: number | null) { return pct == null ? "new" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`; }
export function changeText(value: number) { return `${value > 0 ? "+" : ""}${formatInt(value)}`; }

export function PctPill({ pct, empty }: { pct: number | null; empty?: string }) {
  if (pct == null && empty) return <span className="text-[11px] opacity-30">{empty}</span>;
  const c = tone(pct);
  return (
    <span
      className={`inline-block min-w-[58px] rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${num}`}
      style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}
    >
      {pctText(pct)}
    </span>
  );
}

/** Our % minus the competitor median, in percentage points. */
export function VsPoints({ ours, median }: { ours: number | null; median: number | null }) {
  if (ours == null || median == null) return <span className="text-[11px] opacity-30">—</span>;
  const pts = (ours - median) * 100;
  const c = pts >= 2 ? "#22c55e" : pts <= -2 ? "#ef4444" : "var(--sb-muted)";
  return (
    <span className={`text-[11px] font-semibold ${num}`} style={{ color: c }} title="Our % change minus the competitors' median % change">
      {pts > 0 ? "+" : ""}{pts.toFixed(1)} pts
    </span>
  );
}

export function Blank() { return <span aria-hidden="true" />; }

/** Empty trailing cells so child rows line up when the comparison columns are on. */
export function PadCells({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, i) => <TableCell key={i} numeric><Blank /></TableCell>)}</>;
}

export function Artwork({ src, alt, size = 32 }: { src: string | null | undefined; alt: string; size?: number }) {
  const style: CSSProperties = { width: size, height: size };
  return src ? (
    <PreviewableArtwork src={src} alt={alt} width={size} height={size} className="rounded-md object-cover sb-ring flex-shrink-0" />
  ) : (
    <div className="rounded-md sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" style={style} />
  );
}

type TrackLike = Pick<ReleaseWeekTrack, "isrc" | "name" | "artist_names" | "album_image_url" | "release_date" | "prev_streams" | "cur_streams">;

/**
 * One track as a child row: artwork, title (links to Catalog for our own tracks), artists, release date + ISRC,
 * then last week / this week / change / %. `indent` in rem steps; `accent` draws a thin coloured edge.
 */
export function TrackRow({
  track: t, indent = 1, linkToCatalog, accent, padCells = 0,
}: { track: TrackLike; indent?: number; linkToCatalog: boolean; accent?: string; padCells?: number }) {
  const prev = Number(t.prev_streams ?? 0);
  const cur = Number(t.cur_streams ?? 0);
  const pct = t.prev_streams == null || prev === 0 ? null : (cur - prev) / prev;
  const title: ReactNode = linkToCatalog ? (
    <Link href={`/catalog?isrc=${encodeURIComponent(t.isrc)}`} className="block truncate font-medium transition-colors sb-link-hover">
      {t.name ?? t.isrc}
    </Link>
  ) : (
    <div className="truncate font-medium">{t.name ?? t.isrc}</div>
  );
  return (
    <TableRow className={childRowClass}>
      <TableCell>
        <div
          className="flex items-center gap-2.5 min-w-0"
          style={{ paddingLeft: `${indent * 1.25}rem`, ...(accent ? { borderLeft: `2px solid ${accent}`, marginLeft: `${indent * 1.25 - 0.75}rem`, paddingLeft: "0.6rem" } : {}) }}
        >
          <Artwork src={t.album_image_url} alt={t.name ?? t.isrc} />
          <div className="min-w-0">
            {title}
            <div className="truncate text-[11px] opacity-60">{t.artist_names?.join(", ") || "—"}</div>
            <div className="truncate text-[10px] opacity-40">
              {t.release_date ? prettyDate(t.release_date, { weekday: true }) : "No release date"}
              {" · "}
              <CopyableIsrc inline isrc={t.isrc} className="font-mono" />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell numeric><Blank /></TableCell>
      <TableCell numeric className={`opacity-70 ${num}`}>{t.prev_streams == null ? "—" : formatInt(prev)}</TableCell>
      <TableCell numeric className={`font-medium ${num}`}>{t.cur_streams == null ? "—" : formatInt(cur)}</TableCell>
      <TableCell numeric className={`font-semibold ${num}`} style={{ color: tone(pct) }}>{changeText(cur - prev)}</TableCell>
      <TableCell numeric><PctPill pct={pct} /></TableCell>
      <PadCells count={padCells} />
    </TableRow>
  );
}
