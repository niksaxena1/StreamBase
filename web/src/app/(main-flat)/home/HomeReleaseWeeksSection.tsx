"use client";

import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { fetchApiJson } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { ReleaseWeekCompetitorRows, type CompetitorLabelInfo } from "./ReleaseWeekCompetitorRows";
import {
  groupCompetitorReleaseWeeks,
  groupReleaseWeeks,
  prettyDate,
  releaseWeekStart,
  type CompetitorSummaryRow,
  type ReleaseBucket,
  type ReleaseWeekTrack,
} from "./releaseWeeks";
import { Artwork, PctPill, TrackRow, VsPoints, changeText, childRowClass, num, tone } from "./releaseWeeksUi";

const KEY = "sb:home-release-weeks-open";
const COMPARE_KEY = "sb:home-release-weeks-competitors";
const PAGE = 50;
type Payload = { runDate: string | null; tracks: ReleaseWeekTrack[]; competitorsAvailable?: boolean };
type CompPayload = { runDate: string; labels: CompetitorLabelInfo[]; rows: CompetitorSummaryRow[] };
type Tab = "ours" | "comps";

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
    <span className="whitespace-nowrap">
      <span className="opacity-50 text-[11px] mr-1">Week of</span>
      <span className="font-semibold">{rest.slice(0, -5)}</span>
      <span className="opacity-40 ml-1 text-[11px]">{year}</span>
      {ago ? <span className="ml-2 text-[10px] italic opacity-35">{ago}</span> : null}
    </span>
  );
}

function headerPill(active: boolean) {
  return [
    "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
    active ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
  ].join(" ");
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${active ? "sb-ring bg-white/70 dark:bg-white/15" : "opacity-55 hover:opacity-90"}`}
    >
      {children}
    </button>
  );
}

export function HomeReleaseWeeksSection() {
  const [open, setOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [ready, setReady] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [comp, setComp] = useState<CompPayload | null>(null);
  const [compError, setCompError] = useState<string | null>(null);
  const [compAttempt, setCompAttempt] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("ours");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setOpen(readStoredBool(KEY, false));
    setCompare(readStoredBool(COMPARE_KEY, false));
    setReady(true);
  }, []);
  useEffect(() => { if (ready) writeStoredBool(KEY, open); }, [ready, open]);
  useEffect(() => { if (ready) writeStoredBool(COMPARE_KEY, compare); }, [ready, compare]);
  useEffect(() => {
    if (!ready || !open || payload) return;
    let active = true;
    fetchApiJson<Payload>("/api/home/release-weeks")
      .then((data) => { if (active) setPayload(data); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : "Failed to load release weeks"); });
    return () => { active = false; };
  }, [ready, open, payload, attempt]);

  const canCompare = Boolean(payload?.competitorsAvailable);
  const compareOn = compare && canCompare;
  const runDate = payload?.runDate ?? null;
  useEffect(() => {
    if (!open || !compareOn || !runDate || comp) return;
    let active = true;
    fetchApiJson<CompPayload>(`/api/home/release-weeks/competitors?run_date=${runDate}`)
      .then((data) => { if (active) setComp(data); })
      .catch((e) => { if (active) setCompError(e instanceof Error ? e.message : "Failed to load competitors"); });
    return () => { active = false; };
  }, [open, compareOn, runDate, comp, compAttempt]);

  const end = runDate ? dataDateFromRunDate(runDate) : null;
  const grouped = useMemo(() => (payload && end ? groupReleaseWeeks(payload.tracks, end) : null), [payload, end]);
  const compBuckets = useMemo(() => (comp && end ? groupCompetitorReleaseWeeks(comp.rows, end) : null), [comp, end]);
  const compTotal = useMemo(() => (comp ? groupCompetitorReleaseWeeks(comp.rows.map((r) => ({ ...r, release_date: null })), end ?? "2000-01-01").get("unknown") : undefined), [comp, end]);
  const labelInfo = useMemo(() => new Map((comp?.labels ?? []).map((l) => [l.label_key, l])), [comp]);
  const currentFriday = end ? releaseWeekStart(end) : null;
  const totals = grouped?.buckets.reduce(
    (acc, b) => ({ prev: acc.prev + b.prev, cur: acc.cur + b.cur, count: acc.count + b.trackCount }),
    { prev: 0, cur: 0, count: 0 },
  );
  const totalPct = totals && totals.prev ? (totals.cur - totals.prev) / totals.prev : null;
  const subtitle = end
    ? `This week ${prettyDate(addDaysISO(end, -6), { weekday: true, year: false })} – ${prettyDate(end, { weekday: true, year: false })} · last week ${prettyDate(addDaysISO(end, -13), { weekday: true, year: false })} – ${prettyDate(addDaysISO(end, -7), { weekday: true, year: false })}`
    : "This 7 days vs last 7 days, grouped by release week (Fri–Thu)";

  const pad = compareOn ? 2 : 0;
  const cols = 6 + pad;
  const compLoading = compareOn && !comp && !compError;

  const toggle = (key: string) => {
    setSelected((s) => (s === key ? null : key));
    setShowAll(false);
    setTab("ours");
  };
  const onKey = (key: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); }
  };

  const compCells = (median: number | null | undefined, n: number | undefined, ours: number | null) => (
    <>
      <TableCell numeric>
        {compLoading ? (
          <span className="inline-block h-4 w-14 animate-pulse rounded-full bg-black/5 dark:bg-white/10" />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <PctPill pct={median ?? null} empty="—" />
            {n ? <span className="text-[10px] opacity-35" title="Competitors with releases in this range">{n}</span> : null}
          </span>
        )}
      </TableCell>
      <TableCell numeric>{compLoading ? null : <VsPoints ours={ours} median={median ?? null} />}</TableCell>
    </>
  );

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
              {canCompare ? (
                <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
                  <button type="button" className={headerPill(!compareOn)} onClick={() => setCompare(false)}>Ours</button>
                  <button type="button" className={headerPill(compareOn)} onClick={() => setCompare(true)} title="Compare with competitors' releases from the same weeks">
                    vs Competitors
                  </button>
                </div>
              ) : null}
              <ChartCsvDownloadButton
                filename={`home-release-weeks-${end}.csv`}
                title="Download release weeks CSV"
                sortForExport={false}
                rows={grouped.buckets.map((b) => {
                  const c = compBuckets?.get(b.key);
                  return {
                    Released: b.label,
                    Tracks: b.trackCount,
                    "Last 7 days": b.prev,
                    "This 7 days": b.cur,
                    Change: b.change,
                    "%": b.pct == null ? "new" : Number((b.pct * 100).toFixed(1)),
                    ...(compareOn && compBuckets
                      ? {
                          "Competitor median %": c?.medianPct == null ? "" : Number((c.medianPct * 100).toFixed(1)),
                          Competitors: c?.labels.length ?? 0,
                          "Vs competitors (pts)": b.pct == null || c?.medianPct == null ? "" : Number(((b.pct - c.medianPct) * 100).toFixed(1)),
                        }
                      : {}),
                  };
                })}
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
          ) : !grouped || !runDate ? (
            <div className="text-sm opacity-70">No release-week data available.</div>
          ) : (
            <>
              {compareOn && compError ? (
                <div className="mb-2 text-xs">
                  Competitor comparison failed to load.{" "}
                  <button type="button" className="underline" onClick={() => { setCompError(null); setCompAttempt((n) => n + 1); }}>
                    Retry
                  </button>
                </div>
              ) : null}
              <GlassTable
                headers={[
                  "RELEASED",
                  { label: "TRACKS", align: "right" as const },
                  { label: "LAST WEEK", align: "right" as const },
                  { label: "THIS WEEK", align: "right" as const },
                  { label: "CHANGE", align: "right" as const },
                  { label: "%", align: "right" as const },
                  ...(compareOn
                    ? [
                        { label: "COMPETITORS", align: "right" as const },
                        { label: "VS COMPS", align: "right" as const },
                      ]
                    : []),
                ]}
                maxBodyHeightClassName="max-h-[720px]"
              >
                {grouped.buckets.length === 0 ? <EmptyState colSpan={cols} message="No tracks found" /> : null}
                {grouped.buckets.map((b) => {
                  const isOpen = selected === b.key;
                  const shown = showAll ? b.tracks : b.tracks.slice(0, PAGE);
                  const c = compBuckets?.get(b.key);
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
                        {compareOn ? compCells(c?.medianPct, c?.labels.length, b.pct) : null}
                      </TableRow>

                      {isOpen && compareOn ? (
                        <TableRow className={childRowClass}>
                          <TableCell colSpan={cols}>
                            <div className="flex items-center gap-1 pl-5">
                              <TabButton active={tab === "ours"} onClick={() => setTab("ours")}>Our tracks · {formatInt(b.trackCount)}</TabButton>
                              <TabButton active={tab === "comps"} onClick={() => setTab("comps")}>
                                Competitors{c ? ` · ${c.labels.length}` : ""}
                              </TabButton>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}

                      {isOpen && compareOn && tab === "comps" ? (
                        compBuckets ? (
                          <ReleaseWeekCompetitorRows runDate={runDate} bucket={b} comp={c} labels={labelInfo} padCells={pad} />
                        ) : (
                          <TableRow className={childRowClass}>
                            <TableCell colSpan={cols}><div className="ml-5 h-8 animate-pulse rounded-md bg-black/5 dark:bg-white/10" aria-label="Loading competitors" /></TableCell>
                          </TableRow>
                        )
                      ) : null}

                      {isOpen && (!compareOn || tab === "ours")
                        ? shown.map((t) => <TrackRow key={t.isrc} track={t} linkToCatalog padCells={pad} />)
                        : null}
                      {isOpen && (!compareOn || tab === "ours") && b.trackCount > PAGE && !showAll ? (
                        <TableRow className={childRowClass}>
                          <TableCell colSpan={cols}>
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
                    {compareOn ? compCells(compTotal?.medianPct, compTotal?.labels.length, totalPct) : null}
                  </TableRow>
                ) : null}
                {compareOn ? (
                  <TableRow>
                    <TableCell colSpan={cols}>
                      <span className="text-[10px] opacity-40">
                        Competitors = median of each competitor&apos;s own % change for releases in the same range (so one big label can&apos;t dominate); the small number is how many competitors released then. Vs comps = our % minus that median, in points. Open a week and pick the Competitors tab to see each one.
                      </span>

                    </TableCell>
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
                        <Artwork src={track.album_image_url} alt={track.name ?? track.isrc} size={24} />
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
