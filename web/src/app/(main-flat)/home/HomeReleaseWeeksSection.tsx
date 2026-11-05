"use client";

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import Link from "@/components/shell/RouteLink";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { groupReleaseWeeks, prettyDate, releaseWeekStart, type ReleaseBucket, type ReleaseWeekTrack } from "./releaseWeeks";

const KEY = "sb:home-release-weeks-open";
const PAGE = 50;
type Payload = { runDate: string | null; tracks: ReleaseWeekTrack[] };

function tone(pct: number | null): string {
  if (pct == null) return "#3b82f6";
  if (pct <= -0.15) return "#ef4444";
  if (pct <= -0.05) return "#f97316";
  if (pct >= 0.05) return "#22c55e";
  return "var(--sb-muted)";
}
function pctText(pct: number | null) { return pct == null ? "new" : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`; }
function changeText(value: number) { return `${value > 0 ? "+" : ""}${formatInt(value)}`; }
const num = "tabular-nums";

function PctPill({ pct }: { pct: number | null }) {
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

function Artwork({ track, size = 32 }: { track: ReleaseWeekTrack; size?: number }) {
  const style: CSSProperties = { width: size, height: size };
  return track.album_image_url ? (
    <PreviewableArtwork
      src={track.album_image_url}
      alt={track.name ?? track.isrc}
      width={size}
      height={size}
      className="rounded-md object-cover sb-ring flex-shrink-0"
    />
  ) : (
    <div className="rounded-md sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" style={style} />
  );
}

/** Up to 4 overlapping covers of the group's biggest tracks (by this week's streams). */
function CoverStack({ bucket }: { bucket: ReleaseBucket }) {
  const covers = [...bucket.tracks]
    .filter((t) => t.album_image_url)
    .sort((a, b) => Number(b.cur_streams ?? 0) - Number(a.cur_streams ?? 0))
    .slice(0, 4);
  if (covers.length === 0) return null;
  return (
    <div className="hidden sm:flex items-center -space-x-2">
      {covers.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t.isrc}
          src={t.album_image_url ?? ""}
          alt=""
          loading="lazy"
          className="h-6 w-6 rounded-md object-cover sb-ring"
          style={{ boxShadow: "0 0 0 2px var(--sb-panel, transparent)" }}
        />
      ))}
    </div>
  );
}

/** "this week" / "last week" / "3 wks ago", relative to the release week holding the latest data date. */
export function weeksAgoLabel(friday: string, currentFriday: string): string {
  const weeks = Math.round((Date.parse(`${currentFriday}T00:00:00Z`) - Date.parse(`${friday}T00:00:00Z`)) / (7 * 86_400_000));
  if (weeks <= 0) return "this week";
  if (weeks === 1) return "last week";
  return `${weeks} wks ago`;
}

function bucketTitle(b: ReleaseBucket, currentFriday: string | null) {
  if (b.kind !== "week") return <span className="font-semibold">{b.label}</span>;
  const ago = currentFriday ? weeksAgoLabel(b.sortDate, currentFriday) : null;
  const rest = b.label.replace(/^Week of /, "");
  const year = rest.slice(-4);
  return (
    <span>
      <span className="opacity-50 text-[11px] mr-1">Week of</span>
      <span className="font-semibold">{rest.slice(0, -5)}</span>
      <span className="opacity-40 ml-1 text-[11px]">{year}</span>
      {ago ? <span className="ml-2 text-[10px] italic opacity-35">{ago}</span> : null}
    </span>
  );
}

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
    fetchApiJson<Payload>("/api/home/release-weeks")
      .then((data) => { if (active) setPayload(data); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load release weeks"); });
    return () => { active = false; };
  }, [ready, open, payload, attempt]);

  const end = payload?.runDate ? dataDateFromRunDate(payload.runDate) : null;
  const grouped = useMemo(() => (payload && end ? groupReleaseWeeks(payload.tracks, end) : null), [payload, end]);
  const currentFriday = end ? releaseWeekStart(end) : null;
  const totals = grouped?.buckets.reduce(
    (acc, b) => ({ prev: acc.prev + b.prev, cur: acc.cur + b.cur, count: acc.count + b.trackCount }),
    { prev: 0, cur: 0, count: 0 },
  );
  const totalPct = totals && totals.prev ? (totals.cur - totals.prev) / totals.prev : null;
  const subtitle = end
    ? `This week ${prettyDate(addDaysISO(end, -6), { weekday: true, year: false })} – ${prettyDate(end, { weekday: true, year: false })} · last week ${prettyDate(addDaysISO(end, -13), { weekday: true, year: false })} – ${prettyDate(addDaysISO(end, -7), { weekday: true, year: false })}`
    : "This 7 days vs last 7 days, grouped by release week (Fri–Thu)";

  const toggle = (key: string) => { setSelected((s) => (s === key ? null : key)); setShowAll(false); };
  const onKey = (key: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); }
  };

  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <span
              className="mt-0.5 flex-shrink-0 text-xs opacity-60 transition-transform duration-150"
              style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▸
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">Change by release week</div>
              {open ? <div className="mt-0.5 text-[10px] opacity-40">{subtitle}</div> : null}
            </div>
          </div>
          {open && grouped ? (
            <div
              className="flex items-center gap-2 flex-shrink-0"
              onMouseDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
            >
              <ChartCsvDownloadButton
                filename={`home-release-weeks-${end}.csv`}
                title="Download release weeks CSV"
                sortForExport={false}
                rows={grouped.buckets.map((b) => ({
                  Released: b.label,
                  Tracks: b.trackCount,
                  "Last 7 days": b.prev,
                  "This 7 days": b.cur,
                  Change: b.change,
                  "%": b.pct == null ? "new" : Number((b.pct * 100).toFixed(1)),
                }))}
              />
            </div>
          ) : null}
        </div>
      </summary>

      {open ? (
        <div className="mt-3">
          {error ? (
            <div className="text-sm">
              {error}{" "}
              <button type="button" className="underline" onClick={() => { setError(null); setAttempt((n) => n + 1); }}>
                Retry
              </button>
            </div>
          ) : !payload ? (
            <div className="h-24 animate-pulse rounded-lg bg-black/5 dark:bg-white/10" aria-label="Loading release weeks" />
          ) : !grouped ? (
            <div className="text-sm opacity-70">No release-week data available.</div>
          ) : (
            <>
              <GlassTable
                headers={[
                  "RELEASED",
                  { label: "TRACKS", align: "right" as const },
                  { label: "LAST WEEK", align: "right" as const },
                  { label: "THIS WEEK", align: "right" as const },
                  { label: "CHANGE", align: "right" as const },
                  { label: "%", align: "right" as const },
                ]}
                maxBodyHeightClassName="max-h-[720px]"
              >
                {grouped.buckets.length === 0 ? <EmptyState colSpan={6} message="No tracks found" /> : null}
                {grouped.buckets.map((b) => {
                  const isOpen = selected === b.key;
                  const shown = showAll ? b.tracks : b.tracks.slice(0, PAGE);
                  return (
                    <Fragment key={b.key}>
                      <TableRow
                        className={`cursor-pointer ${isOpen ? "bg-black/[0.03] dark:bg-white/[0.04]" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isOpen}
                        onClick={() => toggle(b.key)}
                        onKeyDown={onKey(b.key)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              aria-hidden="true"
                              className="text-[10px] opacity-50 transition-transform duration-150"
                              style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                            >
                              ▸
                            </span>
                            <CoverStack bucket={b} />
                            {bucketTitle(b, currentFriday)}
                          </div>
                        </TableCell>
                        <TableCell numeric className={`opacity-60 ${num}`}>{formatInt(b.trackCount)}</TableCell>
                        <TableCell numeric className={`opacity-70 ${num}`}>{formatInt(b.prev)}</TableCell>
                        <TableCell numeric className={`font-medium ${num}`}>{formatInt(b.cur)}</TableCell>
                        <TableCell numeric className={`font-semibold ${num}`} style={{ color: tone(b.pct) }}>{changeText(b.change)}</TableCell>
                        <TableCell numeric><PctPill pct={b.pct} /></TableCell>
                      </TableRow>

                      {isOpen
                        ? shown.map((t) => {
                            const prev = Number(t.prev_streams ?? 0);
                            const cur = Number(t.cur_streams ?? 0);
                            const pct = t.prev_streams == null || prev === 0 ? null : (cur - prev) / prev;
                            const artists = t.artist_names?.join(", ") || "—";
                            return (
                              <TableRow key={t.isrc} className="bg-black/[0.02] dark:bg-white/[0.025]">
                                <TableCell>
                                  <div className="flex items-center gap-2.5 min-w-0 pl-5">
                                    <Artwork track={t} />
                                    <div className="min-w-0">
                                      <Link
                                        href={`/catalog?isrc=${encodeURIComponent(t.isrc)}`}
                                        className="block truncate font-medium transition-colors sb-link-hover"
                                      >
                                        {t.name ?? t.isrc}
                                      </Link>
                                      <div className="truncate text-[11px] opacity-60">{artists}</div>
                                      <div className="truncate text-[10px] opacity-40">
                                        {t.release_date ? prettyDate(t.release_date, { weekday: true }) : "No release date"}
                                        {" · "}
                                        <CopyableIsrc inline isrc={t.isrc} className="font-mono" />
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell numeric><span aria-hidden="true" /></TableCell>
                                <TableCell numeric className={`opacity-70 ${num}`}>{t.prev_streams == null ? "—" : formatInt(prev)}</TableCell>
                                <TableCell numeric className={`font-medium ${num}`}>{t.cur_streams == null ? "—" : formatInt(cur)}</TableCell>
                                <TableCell numeric className={`font-semibold ${num}`} style={{ color: tone(pct) }}>{changeText(cur - prev)}</TableCell>
                                <TableCell numeric><PctPill pct={pct} /></TableCell>
                              </TableRow>
                            );
                          })
                        : null}
                      {isOpen && b.trackCount > PAGE && !showAll ? (
                        <TableRow className="bg-black/[0.02] dark:bg-white/[0.025]">
                          <TableCell colSpan={6}>
                            <button type="button" className="pl-5 text-xs font-medium sb-link-hover" onClick={() => setShowAll(true)}>
                              Show all {formatInt(b.trackCount)} tracks
                            </button>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
                {totals ? (
                  <TableRow className="border-t-2" style={{ borderColor: "var(--sb-border)" }}>
                    <TableCell><span className="pl-6 font-bold">Total</span></TableCell>
                    <TableCell numeric className={`font-semibold ${num}`}>{formatInt(totals.count)}</TableCell>
                    <TableCell numeric className={`font-semibold opacity-80 ${num}`}>{formatInt(totals.prev)}</TableCell>
                    <TableCell numeric className={`font-bold ${num}`}>{formatInt(totals.cur)}</TableCell>
                    <TableCell numeric className={`font-bold ${num}`} style={{ color: tone(totalPct) }}>{changeText(totals.cur - totals.prev)}</TableCell>
                    <TableCell numeric><PctPill pct={totalPct} /></TableCell>
                  </TableRow>
                ) : null}
              </GlassTable>

              {grouped.resets.length > 0 ? (
                <div
                  className="mt-3 rounded-lg border p-3"
                  style={{ borderColor: "color-mix(in srgb, #f59e0b 35%, transparent)", background: "color-mix(in srgb, #f59e0b 6%, transparent)" }}
                >
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wider" style={{ color: "#f59e0b" }}>
                    Counter resets · not counted in the totals
                  </div>
                  <div className="space-y-1.5">
                    {grouped.resets.map(({ track, drop, dataDate }) => (
                      <div key={track.isrc} className="flex items-center gap-2.5 text-xs">
                        <Artwork track={track} size={24} />
                        <div className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{track.artist_names?.join(", ") || "—"} – {track.name ?? "—"}</span>
                          <span className="ml-1.5 font-mono text-[10px] opacity-40">{track.isrc}</span>
                        </div>
                        <span className={`font-semibold ${num}`} style={{ color: "#ef4444" }}>{formatInt(drop)}</span>
                        <span className="w-14 text-right opacity-50">{dataDate ? prettyDate(dataDate, { year: false }) : ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </details>
  );
}
