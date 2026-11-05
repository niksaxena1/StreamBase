"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { groupReleaseWeeks, prettyDate, type ReleaseWeekTrack } from "./releaseWeeks";

const KEY = "sb:home-release-weeks-open";
type Payload = { runDate: string | null; tracks: ReleaseWeekTrack[] };
function dateLabel(date: string, year = false) {
  return prettyDate(date, { weekday: true, year });
}
function color(pct: number | null) {
  if (pct == null) return "var(--sb-muted)";
  if (pct <= -0.15) return "#ef4444";
  if (pct <= -0.05) return "#f97316";
  if (pct >= 0.05) return "#22c55e";
  return "var(--sb-muted)";
}
function percent(pct: number | null) { return pct == null ? "new" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`; }
function change(value: number) { return `${value > 0 ? "+" : ""}${formatInt(value)}`; }
const numericHeaders = (names: string[]) => names.map(label => ({ label, align: "right" as const }));

export function HomeReleaseWeeksSection() {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setOpen(readStoredBool(KEY, false)); setReady(true); }, []);
  useEffect(() => { if (ready) writeStoredBool(KEY, open); }, [ready, open]);
  useEffect(() => {
    if (!ready || !open || payload) return;
    let active = true;
    fetchApiJson<Payload>("/api/home/release-weeks").then(data => { if (active) setPayload(data); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Failed to load release weeks"); });
    return () => { active = false; };
  }, [ready, open, payload, attempt]);
  const grouped = useMemo(() => payload?.runDate ? groupReleaseWeeks(payload.tracks, dataDateFromRunDate(payload.runDate)) : null, [payload]);
  const totals = grouped?.buckets.reduce((acc, b) => ({ prev: acc.prev + b.prev, cur: acc.cur + b.cur, count: acc.count + b.trackCount }), { prev: 0, cur: 0, count: 0 });
  const totalPct = totals && totals.prev ? (totals.cur - totals.prev) / totals.prev : null;
  const end = payload?.runDate ? dataDateFromRunDate(payload.runDate) : null;
  const subtitle = end ? `${dateLabel(addDaysISO(end, -6))} – ${dateLabel(end, true)} vs ${dateLabel(addDaysISO(end, -13))} – ${dateLabel(addDaysISO(end, -7), true)}` : "Latest 7 days vs previous 7 days";
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-xl border sb-panel p-3" style={{ borderColor: "var(--sb-border)" }}>
    <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
      <div className="flex items-start justify-between gap-3"><div className="flex gap-2"><span className="text-xs opacity-60" style={{ transform: open ? "rotate(90deg)" : undefined }}>▸</span><div><div className="text-[11px] font-medium uppercase tracking-wider opacity-60">Change by release week</div>{open && <div className="mt-0.5 text-[10px] opacity-40">{subtitle}</div>}</div></div>
      {open && grouped && <div onClick={e => { e.preventDefault(); e.stopPropagation(); }}><ChartCsvDownloadButton filename={`home-release-weeks-${end}.csv`} title="Download release weeks CSV" sortForExport={false} rows={grouped.buckets.map(b => ({ Released: b.label, Tracks: b.trackCount, "Last 7 days": b.prev, "This 7 days": b.cur, Change: b.change, "%": b.pct == null ? "new" : b.pct * 100 }))} /></div>}</div>
    </summary>
    {open && <div className="mt-3">{error ? <div className="text-sm">{error} <button className="underline" onClick={() => { setError(null); setAttempt(n => n + 1); }}>Retry</button></div> : !payload ? <div className="h-24 animate-pulse rounded-lg bg-black/5 dark:bg-white/10" aria-label="Loading release weeks" /> : !grouped ? <div className="text-sm opacity-70">No release-week data available.</div> : <>
      <GlassTable headers={["Released", ...numericHeaders(["Tracks", "Last 7 days", "This 7 days", "Change", "%"])]} maxBodyHeightClassName="max-h-[700px]">
        {grouped.buckets.length === 0 && <EmptyState colSpan={6} message="No tracks found" />}
        {grouped.buckets.map(b => <Fragment key={b.key}>
          <TableRow className="cursor-pointer" role="button" tabIndex={0} aria-expanded={selected === b.key} onClick={() => { setSelected(selected === b.key ? null : b.key); setShowAll(false); }} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(selected === b.key ? null : b.key); setShowAll(false); } }}>
            <TableCell><span aria-hidden="true">{selected === b.key ? "▾" : "▸"}</span> {b.label}</TableCell><TableCell numeric>{formatInt(b.trackCount)}</TableCell><TableCell numeric>{formatInt(b.prev)}</TableCell><TableCell numeric>{formatInt(b.cur)}</TableCell><TableCell numeric style={{ color: color(b.pct) }}>{change(b.change)}</TableCell><TableCell numeric style={{ color: color(b.pct) }}>{percent(b.pct)}</TableCell>
          </TableRow>
          {selected === b.key && <TableRow><TableCell colSpan={6}><GlassTable headers={["Artist", "Title", "ISRC", "Release date", ...numericHeaders(["Last 7 days", "This 7 days", "Change", "%"])]} maxBodyHeightClassName="max-h-[500px]">
            {(showAll ? b.tracks : b.tracks.slice(0, 50)).map(t => { const prev = Number(t.prev_streams ?? 0), cur = Number(t.cur_streams ?? 0), pct = prev ? (cur - prev) / prev : null; return <TableRow key={t.isrc}><TableCell>{t.artist_names?.join(", ") || "—"}</TableCell><TableCell>{t.name ?? "—"}</TableCell><TableCell><CopyableIsrc isrc={t.isrc} /></TableCell><TableCell>{t.release_date ? prettyDate(t.release_date) : "—"}</TableCell><TableCell numeric>{t.prev_streams == null ? "new" : formatInt(prev)}</TableCell><TableCell numeric>{t.cur_streams == null ? "—" : formatInt(cur)}</TableCell><TableCell numeric style={{ color: color(pct) }}>{change(cur - prev)}</TableCell><TableCell numeric style={{ color: color(pct) }}>{percent(pct)}</TableCell></TableRow>; })}
          </GlassTable>{b.trackCount > 50 && !showAll && <button type="button" className="mt-2 underline" onClick={() => setShowAll(true)}>Show all {formatInt(b.trackCount)}</button>}</TableCell></TableRow>}
        </Fragment>)}
        {totals && <TableRow className="font-bold"><TableCell>Total</TableCell><TableCell numeric>{formatInt(totals.count)}</TableCell><TableCell numeric>{formatInt(totals.prev)}</TableCell><TableCell numeric>{formatInt(totals.cur)}</TableCell><TableCell numeric style={{ color: color(totalPct) }}>{change(totals.cur - totals.prev)}</TableCell><TableCell numeric style={{ color: color(totalPct) }}>{percent(totalPct)}</TableCell></TableRow>}
      </GlassTable>
      {grouped.resets.length > 0 && <div className="mt-3 text-xs opacity-70"><div>Counter resets excluded from totals:</div>{grouped.resets.map(({ track, drop, dataDate }) => <div key={track.isrc}>{track.artist_names?.join(", ") || "—"} – {track.name ?? "—"} ({track.isrc}): {formatInt(drop)}{dataDate ? ` on ${prettyDate(dataDate, { year: false })}` : ""}</div>)}</div>}
    </>}</div>}
  </details>;
}
