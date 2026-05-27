"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { RefreshButton } from "@/components/health/RefreshButton";
import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatDateISO, formatInt } from "@/lib/format";
import type { CompetitorHealthKpiFilter, CompetitorHealthPageData } from "@/lib/health/competitor/types";

import { CompetitorWarningHistoryChart } from "./CompetitorWarningHistoryChart";
import { CompetitorWarningTable } from "./CompetitorWarningRow";

function pipelineStatusColor(status: string): string {
  if (status === "ok") return "var(--sb-positive)";
  if (status === "error") return "#ef4444";
  if (status === "warn") return "#f59e0b";
  return "var(--sb-muted)";
}

export function CompetitorHealthClient({ data }: { data: CompetitorHealthPageData }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const buildHref = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (!params.get("date") && data.selectedDataDate) {
        params.set("date", data.selectedDataDate);
      }
      const qs = params.toString();
      return qs ? `/health?${qs}` : "/health";
    },
    [data.selectedDataDate, searchParams],
  );

  const kpiTiles: Array<{
    key: CompetitorHealthKpiFilter | "failed";
    label: string;
    value: number;
    filter?: CompetitorHealthKpiFilter;
  }> = useMemo(
    () => [
      { key: "failed", label: "Failed runs (30d)", value: data.kpis.failedRuns },
      { key: "stale", label: "Stale playlists", value: data.kpis.stalePlaylists, filter: "stale" },
      { key: "mismatch", label: "Row mismatches", value: data.kpis.rowMismatches, filter: "mismatch" },
      { key: "missing", label: "Missing totals", value: data.kpis.missingTotals, filter: "missing" },
      { key: "no_export", label: "Missing exports", value: data.kpis.missingExports, filter: "no_export" },
      { key: "unenriched", label: "Unenriched tracks", value: data.kpis.unenrichedTracks, filter: "unenriched" },
    ],
    [data.kpis],
  );

  const activeFilterLabel =
    data.kpiFilter === "all"
      ? null
      : kpiTiles.find((t) => t.filter === data.kpiFilter)?.label ?? data.kpiFilter;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitor Health"
        subtitle={
          data.selectedDataDate
            ? `Pipeline checks for data date ${formatDateISO(data.selectedDataDate)}`
            : "Competitor pipeline checks."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--sb-muted)" }}>
              <span className="whitespace-nowrap">Data date</span>
              <select
                className="sb-ring rounded-lg bg-white/60 px-2 py-1.5 text-xs dark:bg-white/10"
                style={{ color: "var(--sb-text)" }}
                value={data.selectedDataDate ?? ""}
                onChange={(e) => router.push(buildHref({ date: e.target.value, page: null, enrich_page: null }))}
              >
                {data.runOptions.map((run) => (
                  <option key={run.run_date} value={run.data_date}>
                    {formatDateISO(run.data_date)} ({run.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--sb-muted)" }}>
              <span className="whitespace-nowrap">Label</span>
              <select
                className="sb-ring rounded-lg bg-white/60 px-2 py-1.5 text-xs dark:bg-white/10"
                style={{ color: "var(--sb-text)" }}
                value={data.selectedLabelKey ?? ""}
                onChange={(e) =>
                  router.push(buildHref({ label: e.target.value || null, page: null, enrich_page: null }))
                }
              >
                <option value="">All labels</option>
                {data.labelOptions.map((l) => (
                  <option key={l.label_key} value={l.label_key}>
                    {l.display_name}
                  </option>
                ))}
              </select>
            </label>
            <RefreshButton />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--sb-muted)" }}>
        <Link href="/competitors" className="sb-link-hover font-medium">
          Competitor analytics →
        </Link>
        {data.kpis.missingThumbnails > 0 ? (
          <span>· {formatInt(data.kpis.missingThumbnails)} playlist(s) missing thumbnails</span>
        ) : null}
        {activeFilterLabel ? (
          <button
            type="button"
            className="sb-link-hover"
            onClick={() => router.push(buildHref({ filter: null }))}
          >
            · Clearing filter: {activeFilterLabel} ×
          </button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpiTiles.map((tile) => {
          const isActive = tile.filter != null && data.kpiFilter === tile.filter;
          const isClickable = tile.key === "failed" ? tile.value > 0 : Boolean(tile.filter);
          const className = [
            "sb-card p-3 text-left transition",
            isActive ? "ring-2 ring-[var(--sb-accent)]" : "",
            isClickable ? "hover:bg-white/40 dark:hover:bg-white/10 cursor-pointer" : "",
          ].join(" ");

          const inner = (
            <>
              <div className="text-[10px] uppercase tracking-wider opacity-60">{tile.label}</div>
              <div className="mt-0.5 font-display text-xl font-semibold tabular-nums">
                {formatInt(tile.value)}
              </div>
            </>
          );

          if (tile.key === "failed" && tile.value > 0) {
            return (
              <button
                key={tile.key}
                type="button"
                className={className}
                onClick={() => {
                  document.getElementById("competitor-ingestion-runs")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                {inner}
              </button>
            );
          }

          if (tile.filter) {
            return (
              <button
                key={tile.key}
                type="button"
                className={className}
                onClick={() =>
                  router.push(
                    buildHref({
                      filter: isActive ? null : tile.filter,
                      enrich_page: tile.filter === "unenriched" ? "1" : null,
                    }),
                  )
                }
              >
                {inner}
              </button>
            );
          }

          return (
            <div key={tile.key} className={className}>
              {inner}
            </div>
          );
        })}
      </div>

      <div className="sb-card p-4">
        <div className="text-xs font-medium uppercase tracking-wider opacity-60">Pipeline status</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.pipelineStages.map((stage) => (
            <div
              key={stage.id}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--sb-border)" }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: pipelineStatusColor(stage.status) }}
                />
                <span className="text-xs font-medium">{stage.label}</span>
              </div>
              <div className="mt-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
                {stage.detail}
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.labelRows.length > 1 ? (
        <CollapsibleSection
          title="Label summary"
          storageKey="sb:health:competitor:label_summary"
          defaultOpen
        >
          <GlassTable
            headers={[
              "Label",
              { label: "Playlists", align: "right" as const },
              { label: "Distinct tracks", align: "right" as const },
              { label: "Σ playlist tracks", align: "right" as const },
              { label: "Missing totals", align: "right" as const },
              { label: "Issues", align: "right" as const },
            ]}
          >
            {data.labelRows.map((row) => {
              const issues = row.stale_playlists + row.row_mismatches + row.missing_exports;
              return (
                <TableRow key={row.label_key}>
                  <TableCell>
                    <Link href="/competitors" className="font-medium sb-link-hover">
                      {row.display_name}
                    </Link>
                  </TableCell>
                  <TableCell numeric>{formatInt(row.playlist_count)}</TableCell>
                  <TableCell numeric>{row.distinct_tracks == null ? "—" : formatInt(row.distinct_tracks)}</TableCell>
                  <TableCell numeric className="opacity-70">
                    {formatInt(row.summed_track_count)}
                  </TableCell>
                  <TableCell numeric>{formatInt(row.missing_totals)}</TableCell>
                  <TableCell numeric className={issues > 0 ? "text-amber-500" : ""}>
                    {formatInt(issues)}
                  </TableCell>
                </TableRow>
              );
            })}
          </GlassTable>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection title="Playlist checks" storageKey="sb:health:competitor:playlist_checks" defaultOpen>
        <GlassTable
          headers={[
            "Playlist",
            "Latest",
            "Tracks",
            "Export rows",
            "Daily",
            "Missing",
            "Status",
          ]}
        >
          {data.playlistRows.map((playlist) => (
            <TableRow key={playlist.playlist_key}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  {playlist.spotify_playlist_image_url ? (
                    <PreviewableArtwork
                      src={playlist.spotify_playlist_image_url}
                      alt=""
                      width={32}
                      height={32}
                      className="h-8 w-8 shrink-0 rounded object-cover sb-ring"
                      label={playlist.display_name}
                    />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded bg-white/10 sb-ring" />
                  )}
                  <div className="min-w-0">
                    <Link
                      href={`/playlists?playlist_key=${encodeURIComponent(playlist.playlist_key)}`}
                      className="block truncate font-medium sb-link-hover"
                    >
                      {playlist.display_name}
                    </Link>
                    <div className="truncate text-[10px] opacity-60">{playlist.label_key}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell mono>{playlist.latest_data_date ? formatDateISO(playlist.latest_data_date) : "—"}</TableCell>
              <TableCell numeric>
                {playlist.track_count == null ? "—" : formatInt(playlist.track_count)}
                {playlist.track_swing ? (
                  <span className={playlist.track_swing > 0 ? "ml-1 text-lime-500" : "ml-1 text-red-500"}>
                    ({playlist.track_swing > 0 ? "+" : ""}
                    {formatInt(playlist.track_swing)})
                  </span>
                ) : null}
              </TableCell>
              <TableCell numeric className={playlist.row_mismatch ? "text-amber-500" : ""}>
                {playlist.export_rows_count == null ? "—" : formatInt(playlist.export_rows_count)}
              </TableCell>
              <TableCell numeric>
                {playlist.daily_streams_net == null ? "—" : formatInt(playlist.daily_streams_net)}
              </TableCell>
              <TableCell numeric>{formatInt(playlist.missing_streams_track_count)}</TableCell>
              <TableCell>
                <span
                  className={[
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                    playlist.bad
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                      : "bg-lime-500/20 text-lime-700 dark:text-lime-300",
                  ].join(" ")}
                >
                  {playlist.bad ? "check" : "ok"}
                </span>
              </TableCell>
            </TableRow>
          ))}
          {!data.playlistRows.length ? (
            <EmptyState colSpan={7} message="No playlists match the current filter." />
          ) : null}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection
        title={`Raw exports (${data.selectedDataDate ? formatDateISO(data.selectedDataDate) : "run"})`}
        storageKey="sb:health:competitor:raw_exports"
      >
        <GlassTable headers={["Playlist", { label: "Rows", align: "right" as const }, { label: "Exported", align: "right" as const }, "Download"]}>
          {data.exports.map((row) => (
            <TableRow key={row.playlist_key}>
              <TableCell>
                <div className="min-w-0">
                  <div className="truncate font-medium">{row.display_name}</div>
                  <div className="truncate text-[10px] opacity-60">{row.label_key}</div>
                </div>
              </TableCell>
              <TableCell numeric>{formatInt(row.rows_count)}</TableCell>
              <TableCell numeric mono className="text-[10px]">
                {row.exported_at ? new Date(row.exported_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell>
                {row.download_href ? (
                  <a href={row.download_href} className="sb-link-hover text-xs underline">
                    csv
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
          {!data.exports.length ? (
            <EmptyState colSpan={4} message="No raw exports for this run (or filter)." />
          ) : null}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection
        title={`Warnings (${formatInt(data.warnings.totalCount)})`}
        storageKey="sb:health:competitor:warnings"
        defaultOpen
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {(["all", "critical", "warn"] as const).map((severity) => (
            <button
              key={severity}
              type="button"
              className={[
                "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                data.warnings.severityFilter === severity
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-white/50 hover:bg-white/70 dark:bg-white/10",
              ].join(" ")}
              onClick={() => router.push(buildHref({ warn_severity: severity === "all" ? null : severity, page: null }))}
            >
              {severity === "all" ? "All severities" : severity}
            </button>
          ))}
        </div>
        <GlassTable headers={["", "Created", "Playlist", "Severity", "Code", "Message"]}>
          <CompetitorWarningTable rows={data.warnings.rows} />
          {!data.warnings.rows.length ? (
            <EmptyState colSpan={6} message="No warnings for this run and filter." />
          ) : null}
        </GlassTable>
        {data.warnings.totalPages > 1 ? (
          <div className="mt-3 flex items-center justify-between text-xs" style={{ color: "var(--sb-muted)" }}>
            <span>
              Page {data.warnings.page} of {data.warnings.totalPages}
            </span>
            <div className="flex gap-2">
              {data.warnings.page > 1 ? (
                <Link href={buildHref({ page: String(data.warnings.page - 1) })} className="sb-link-hover">
                  ← Prev
                </Link>
              ) : null}
              {data.warnings.page < data.warnings.totalPages ? (
                <Link href={buildHref({ page: String(data.warnings.page + 1) })} className="sb-link-hover">
                  Next →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </CollapsibleSection>

      <CompetitorWarningHistoryChart />

      <CollapsibleSection
        title={`Unenriched tracks (${formatInt(data.unenriched.totalCount)})`}
        storageKey="sb:health:competitor:unenriched"
        defaultOpen={data.kpiFilter === "unenriched"}
      >
        <GlassTable headers={["ISRC", "Track", "Missing"]}>
          {data.unenriched.rows.map((track) => (
            <TableRow key={track.isrc}>
              <TableCell mono className="text-xs">
                <Link href={`/tracks/${encodeURIComponent(track.isrc)}`} className="sb-link-hover">
                  {track.isrc}
                </Link>
              </TableCell>
              <TableCell>{track.name}</TableCell>
              <TableCell className="text-xs opacity-80">
                {[track.missing_artists ? "artists" : null, track.missing_image ? "image" : null]
                  .filter(Boolean)
                  .join(", ") || "—"}
              </TableCell>
            </TableRow>
          ))}
          {!data.unenriched.rows.length ? (
            <EmptyState colSpan={3} message="No unenriched tracks on this page." />
          ) : null}
        </GlassTable>
        {data.unenriched.totalPages > 1 ? (
          <div className="mt-3 flex items-center justify-between text-xs" style={{ color: "var(--sb-muted)" }}>
            <span>
              Page {data.unenriched.page} of {data.unenriched.totalPages}
            </span>
            <div className="flex gap-2">
              {data.unenriched.page > 1 ? (
                <Link href={buildHref({ enrich_page: String(data.unenriched.page - 1) })} className="sb-link-hover">
                  ← Prev
                </Link>
              ) : null}
              {data.unenriched.page < data.unenriched.totalPages ? (
                <Link href={buildHref({ enrich_page: String(data.unenriched.page + 1) })} className="sb-link-hover">
                  Next →
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </CollapsibleSection>

      {data.configDrift.length > 0 ? (
        <CollapsibleSection title="Config drift" storageKey="sb:health:competitor:config_drift">
          <Alert variant="warning" title="config/competitor_playlists.csv mismatch">
            {data.configDrift.length} playlist config issue(s) vs database.
          </Alert>
          <GlassTable headers={["Playlist", "Issue", "Label"]}>
            {data.configDrift.map((row) => (
              <TableRow key={`${row.playlist_key}-${row.issue}`}>
                <TableCell mono className="text-xs">
                  {row.playlist_key}
                </TableCell>
                <TableCell>{row.issue.replaceAll("_", " ")}</TableCell>
                <TableCell>{row.display_name ?? row.label_key ?? "—"}</TableCell>
              </TableRow>
            ))}
          </GlassTable>
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection
        title="Ingestion runs"
        storageKey="sb:health:competitor:ingestion_runs"
        subtitle="Last 30 competitor runs"
      >
        <div id="competitor-ingestion-runs" />
        <GlassTable headers={["Data date", "Status", "Started", "Finished", "Logs"]}>
          {data.runs.map((run) => (
            <TableRow key={run.run_date}>
              <TableCell mono>{formatDateISO(run.data_date)}</TableCell>
              <TableCell>
                <span
                  className={[
                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                    run.status === "success"
                      ? "bg-lime-500/20 text-lime-700 dark:text-lime-300"
                      : "bg-red-500/20 text-red-700 dark:text-red-300",
                  ].join(" ")}
                >
                  {run.status}
                </span>
              </TableCell>
              <TableCell mono className="text-[10px]">
                {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell mono className="text-[10px]">
                {run.finished_at ? new Date(run.finished_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell>
                {run.logs_url ? (
                  <a href={run.logs_url} target="_blank" rel="noreferrer" className="sb-link-hover text-xs underline">
                    open
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
        </GlassTable>
      </CollapsibleSection>
    </div>
  );
}
