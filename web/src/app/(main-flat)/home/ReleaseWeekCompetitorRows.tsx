"use client";

import { Fragment, useEffect, useState, type KeyboardEvent } from "react";
import { TableCell, TableRow } from "@/components/ui/GlassTable";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import type { CompetitorBucket, ReleaseBucket, ReleaseWeekTrack } from "./releaseWeeks";
import { Artwork, Blank, PadCells, PctPill, TrackRow, changeText, childRowClass, num, tone } from "./releaseWeeksUi";

export type CompetitorLabelInfo = { label_key: string; display_name: string; accent_hex: string | null; image_url: string | null };
type CompTrack = Omit<ReleaseWeekTrack, "run_date" | "reset_run_date">;

const FIRST = 10;
const LIMIT = 100;

function accentOf(info: CompetitorLabelInfo | undefined) {
  const hex = info?.accent_hex?.replace(/^#/, "");
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : "var(--sb-accent)";
}

/** One competitor's most affected tracks for a bucket, fetched on demand (cached server-side per day). */
function CompetitorTracks({
  runDate, bucket, labelKey, accent, padCells,
}: { runDate: string; bucket: ReleaseBucket; labelKey: string; accent: string; padCells: number }) {
  const [tracks, setTracks] = useState<CompTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let active = true;
    const qs = new URLSearchParams({ run_date: runDate, label: labelKey });
    if (bucket.from && bucket.to) { qs.set("from", bucket.from); qs.set("to", bucket.to); }
    fetchApiJson<{ tracks: CompTrack[] }>(`/api/home/release-weeks/competitors/tracks?${qs}`)
      .then((d) => { if (active) setTracks(d.tracks); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load tracks"); });
    return () => { active = false; };
  }, [runDate, labelKey, bucket.from, bucket.to]);

  const cols = 6 + padCells;
  if (error) return <TableRow className={childRowClass}><TableCell colSpan={cols}><span className="pl-12 text-xs">{error}</span></TableCell></TableRow>;
  if (!tracks) {
    return (
      <TableRow className={childRowClass}>
        <TableCell colSpan={cols}><div className="ml-12 h-8 animate-pulse rounded-md bg-black/5 dark:bg-white/10" aria-label="Loading tracks" /></TableCell>
      </TableRow>
    );
  }
  if (tracks.length === 0) return <TableRow className={childRowClass}><TableCell colSpan={cols}><span className="pl-12 text-xs opacity-50">No tracks</span></TableCell></TableRow>;
  const shown = all ? tracks : tracks.slice(0, FIRST);
  return (
    <>
      {shown.map((t) => <TrackRow key={t.isrc} track={t} indent={2.4} linkToCatalog={false} accent={accent} padCells={padCells} />)}
      {tracks.length > FIRST && !all ? (
        <TableRow className={childRowClass}>
          <TableCell colSpan={cols}>
            <button type="button" className="pl-12 text-xs font-medium sb-link-hover" onClick={() => setAll(true)}>
              Show {formatInt(tracks.length - FIRST)} more{tracks.length >= LIMIT ? ` (top ${LIMIT} drops)` : ""}
            </button>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * The "Competitors" tab inside an expanded release week: one row per competitor with releases in that
 * range (biggest % drop first); clicking a competitor lists its most affected tracks.
 */
export function ReleaseWeekCompetitorRows({
  runDate, bucket, comp, labels, padCells,
}: { runDate: string; bucket: ReleaseBucket; comp: CompetitorBucket | undefined; labels: Map<string, CompetitorLabelInfo>; padCells: number }) {
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  const cols = 6 + padCells;
  if (!comp || comp.labels.length === 0) {
    return (
      <TableRow className={childRowClass}>
        <TableCell colSpan={cols}><span className="pl-6 text-xs opacity-50">No competitor releases in this range.</span></TableCell>
      </TableRow>
    );
  }
  const toggle = (k: string) => setOpenLabel((s) => (s === k ? null : k));
  return (
    <>
      {comp.labels.map((l) => {
        const info = labels.get(l.labelKey);
        const accent = accentOf(info);
        const isOpen = openLabel === l.labelKey;
        return (
          <Fragment key={l.labelKey}>
            <TableRow
              className={`${childRowClass} cursor-pointer`}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(l.labelKey)}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(l.labelKey); } }}
            >
              <TableCell>
                <div className="flex items-center gap-2.5 min-w-0 pl-5">
                  <span
                    aria-hidden="true"
                    className="text-[10px] opacity-50 transition-transform duration-150"
                    style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                  >
                    ▸
                  </span>
                  <Artwork src={info?.image_url} alt={info?.display_name ?? l.labelKey} size={26} />
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: accent }} />
                  <span className="truncate font-medium">{info?.display_name ?? l.labelKey}</span>
                </div>
              </TableCell>
              <TableCell numeric className={`opacity-60 ${num}`}>{formatInt(l.tracks)}</TableCell>
              <TableCell numeric className={`opacity-70 ${num}`}>{formatInt(l.prev)}</TableCell>
              <TableCell numeric className={`font-medium ${num}`}>{formatInt(l.cur)}</TableCell>
              <TableCell numeric className={`font-semibold ${num}`} style={{ color: tone(l.pct) }}>{changeText(l.change)}</TableCell>
              <TableCell numeric>{l.prev === 0 && l.cur === 0 ? <span className="text-[11px] opacity-30">—</span> : <PctPill pct={l.pct} />}</TableCell>
              <PadCells count={padCells} />
            </TableRow>
            {isOpen ? <CompetitorTracks runDate={runDate} bucket={bucket} labelKey={l.labelKey} accent={accent} padCells={padCells} /> : null}
          </Fragment>
        );
      })}
      <TableRow className={childRowClass}>
        <TableCell colSpan={cols}>
          <span className="pl-6 text-[10px] opacity-40">
            Median of competitor % changes: <span className={num}>{comp.medianPct == null ? "—" : `${(comp.medianPct * 100).toFixed(1)}%`}</span>
            {" "}across {comp.withPct} competitor{comp.withPct === 1 ? "" : "s"} with streams last week. Counter resets are excluded.
          </span>
          <Blank />
        </TableCell>
      </TableRow>
    </>
  );
}
