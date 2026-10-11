"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowDown, ArrowUp, ListMinus, ListPlus, Play, Plus, Wrench } from "lucide-react";
import Link from "@/components/shell/RouteLink";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { Alert } from "@/components/ui/Alert";
import { fetchApiJson } from "@/lib/api";
import { EVENT_TYPES, type HealthEvent, type HealthEventType } from "@/lib/health/events";
import { formatDateISO, formatInt } from "@/lib/format";

const LABELS: Record<HealthEventType, string> = {
  takedown: "Takedown", restoration: "Restoration", new_track: "New track", playlist_add: "Playlist additions",
  playlist_remove: "Playlist removals", override: "Stream overrides", ingestion: "Ingestion", movement: "Large movement",
};
const ICONS = { takedown: ArrowDown, restoration: ArrowUp, new_track: Plus, playlist_add: ListPlus, playlist_remove: ListMinus, override: Wrench, ingestion: Play, movement: Activity };

export function EventsSection({ mode, labelKey }: { mode: "own" | "competitor"; labelKey?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const scope = `${mode}:${labelKey ?? "all"}`;
  return (
    <CollapsibleSection title="Events" subtitle="Chronological activity for this dataset" storageKey={`sb:health:events:${scope}`} onOpenChange={setExpanded}>
      {expanded ? <EventsList key={scope} mode={mode} labelKey={labelKey} /> : null}
    </CollapsibleSection>
  );
}

function EventsList({ mode, labelKey }: { mode: "own" | "competitor"; labelKey?: string | null }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [filter, setFilter] = useState<HealthEventType | "all">("all");
  const [response, setResponse] = useState<{ days: number; events: HealthEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ days: String(days), mode });
    if (labelKey) params.set("label", labelKey);
    fetchApiJson<{ events: HealthEvent[] }>(`/api/health-events?${params}`).then((data) => {
      if (active) { setResponse({ days, events: data.events }); setError(null); }
    }).catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Failed to load events"); });
    return () => { active = false; };
  }, [days, mode, labelKey, retry]);
  const events = response?.days === days ? response.events : null;
  const visible = events?.filter((event) => filter === "all" || event.type === filter) ?? [];
  const types = mode === "own" ? EVENT_TYPES : EVENT_TYPES.filter((type) => type !== "takedown" && type !== "restoration");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">Window{" "}
          <select aria-label="Events window" value={days} onChange={(e) => { setDays(Number(e.target.value) as 7 | 30 | 90); setError(null); }} className="rounded-lg border sb-panel px-2 py-1" style={{ borderColor: "var(--sb-border)" }}>
            {[7, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
        </label>
        {(["all", ...types] as const).map((type) => (
          <button key={type} type="button" aria-pressed={filter === type} onClick={() => setFilter(type)} className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${filter === type ? "bg-black text-white dark:bg-white dark:text-black" : "bg-white/50 hover:bg-white/70 dark:bg-white/10"}`}>
            {type === "all" ? "All events" : LABELS[type]}
          </button>
        ))}
      </div>
      {error ? <Alert variant="error" title="Events could not load">{error} <button type="button" className="underline" onClick={() => { setError(null); setRetry((n) => n + 1); }}>Retry</button></Alert> : null}
      {!events && !error ? <p role="status" className="px-4 py-3 text-xs opacity-60">Loading events…</p> : null}
      {events ? (
        <GlassTable headers={["Date (UTC)", "Type", "Description", { label: "Count", align: "right" }]} maxBodyHeightClassName="max-h-[520px]">
          {visible.map((event) => {
            const Icon = ICONS[event.type];
            return <TableRow key={event.id}>
              <TableCell mono className="whitespace-nowrap text-xs">{formatDateISO(event.date.slice(0, 10))}</TableCell>
              <TableCell><span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${event.failed ? "text-red-700 dark:text-red-300" : ""}`}><Icon aria-hidden size={14} />{LABELS[event.type]}</span></TableCell>
              <TableCell>
                <div className={event.failed ? "text-red-700 dark:text-red-300" : ""}>
                  {event.href ? <Link href={event.href} className="sb-link-hover hover:underline">{event.description}</Link> : event.description}
                </div>
                {event.tracks ? <details className="mt-1 text-xs"><summary className="cursor-pointer opacity-60">Show {formatInt(event.count)} tracks</summary><ul className="mt-2 space-y-1">{event.tracks.map((track) => <li key={track.isrc}><Link href={track.href} className="sb-link-hover hover:underline">{track.name}</Link> <span className="font-mono opacity-50">{track.isrc}</span></li>)}</ul></details> : null}
              </TableCell>
              <TableCell numeric>{formatInt(event.count)}</TableCell>
            </TableRow>;
          })}
          {!visible.length ? <EmptyState colSpan={4} message="No events in this window and filter." /> : null}
        </GlassTable>
      ) : null}
    </div>
  );
}
