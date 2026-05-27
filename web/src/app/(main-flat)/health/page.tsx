import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { formatDateISO } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { loadHealthPageShell } from "@/lib/health/loadHealthPageShell";

import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { RefreshButton } from "@/components/health/RefreshButton";
import { WarningHistoryChart } from "@/components/health/WarningHistoryChart";
import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

import { WarningsSection } from "@/components/health/WarningsSection";
import { MissingCatalogSection } from "@/components/health/MissingCatalogSection";
import { CompetitorHealthSection } from "./CompetitorHealthSection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Health",
};

type HealthPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function WarningSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-5 w-48 rounded bg-white/10 animate-pulse" />
      <div className="sb-card p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function MissingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-5 w-64 rounded bg-white/10 animate-pulse" />
      <div className="sb-card p-4 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function CompetitorHealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-16 animate-pulse rounded-xl bg-white/5" />
      <div className="grid gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="sb-card h-20 animate-pulse" />
        ))}
      </div>
      <div className="sb-card h-64 animate-pulse" />
    </div>
  );
}

export default async function HealthPage({ searchParams }: HealthPageProps) {
  const sp = (await searchParams) ?? {};
  const getFirst = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const dateFilter = getFirst(sp.date);
  const pageParam = Math.max(1, parseInt(getFirst(sp.page) ?? "1", 10) || 1);
  const viewParamRaw = getFirst(sp.view);
  const warningView =
    viewParamRaw === "resolved" || viewParamRaw === "all" ? viewParamRaw : "active";

  const shell = await loadHealthPageShell({ dateFilter: dateFilter ?? null });

  if (shell.mode === "competitor") {
    return (
      <Suspense fallback={<CompetitorHealthSkeleton />}>
        <CompetitorHealthSection searchParams={sp} />
      </Suspense>
    );
  }

  const { playlistMeta } = shell;

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Health"
        subtitle={
          shell.latestRunDate
            ? `Recent ingestion runs and anomaly warnings. Last ingested: ${dataDateFromRunDate(shell.latestRunDate)}`
            : "Recent ingestion runs and anomaly warnings."
        }
        actions={<RefreshButton />}
      />

      {(shell.runsError || shell.exportsError) && (
        <Alert variant="error" title="Query error">
          {shell.runsError ?? shell.exportsError ?? "unknown error"}
        </Alert>
      )}

      <Suspense fallback={<WarningSkeleton />}>
        <WarningsSection
          runDate={shell.selectedRunDate}
          dataDate={shell.selectedDataDate}
          playlistMeta={playlistMeta}
          page={pageParam}
          dateParam={dateFilter ?? null}
          view={warningView}
        />
      </Suspense>

      <WarningHistoryChart />

      <Suspense fallback={<MissingSkeleton />}>
        <MissingCatalogSection runDate={shell.selectedRunDate} dataDate={shell.selectedDataDate} />
      </Suspense>

      <CollapsibleSection title="Ingestion Runs (30d)" storageKey="sb:health:details:ingestion_runs">
        <GlassTable headers={["Run Date", "Status", "Logs"]} maxBodyHeightClassName="max-h-[260px]">
          {shell.runs.map((r) => (
            <TableRow key={r.run_date as string}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(r.run_date as string))}</TableCell>
              <TableCell>
                <span
                  className={[
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                    r.status === "success"
                      ? "bg-lime-500/20 text-lime-700 dark:bg-lime-500/30 dark:text-lime-300"
                      : "bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300",
                  ].join(" ")}
                >
                  {r.status as string}
                </span>
              </TableCell>
              <TableCell>
                {r.logs_url ? (
                  <a className="underline" href={r.logs_url as string} target="_blank" rel="noreferrer">
                    open
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
          {!shell.runs.length && <EmptyState colSpan={3} message="No ingestion runs yet." />}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection title="Ingestion Thresholds" storageKey="sb:health:details:ingestion_thresholds">
        {shell.healthConfigRows.length > 0 ? (
          <GlassTable headers={["Key", { label: "Value", align: "right" as const }, "Description"]}>
            {shell.healthConfigRows.map((r) => (
              <TableRow key={r.key as string}>
                <TableCell mono className="text-xs">
                  {r.key as string}
                </TableCell>
                <TableCell numeric mono className="text-xs">
                  {r.value_numeric != null
                    ? (r.value_numeric as number) < 1 && (r.value_numeric as number) > 0
                      ? `${((r.value_numeric as number) * 100).toFixed(0)}%`
                      : String(r.value_numeric)
                    : "—"}
                </TableCell>
                <TableCell className="text-xs opacity-70">{r.description as string}</TableCell>
              </TableRow>
            ))}
          </GlassTable>
        ) : (
          <p className="text-xs opacity-50 px-4 py-3">
            No threshold config found. Run the{" "}
            <code className="font-mono">add_health_config_table</code> migration to enable this section.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={
          <>
            Raw Exports{" "}
            {shell.selectedDataDate ? (
              <span className="text-[10px] font-normal normal-case tracking-normal opacity-40">
                ({shell.selectedDataDate})
              </span>
            ) : null}
          </>
        }
        storageKey="sb:health:details:raw_exports"
      >
        <GlassTable
          headers={[
            { label: "Playlist" },
            { label: "Rows", align: "right" as const },
            { label: "Exported", align: "right" as const },
            { label: "Download" },
          ]}
        >
          {shell.exportsForLatest.map((r) => (
            <TableRow key={r.playlist_key as string}>
              <TableCell mono className="text-xs">
                {(() => {
                  const key = String(r.playlist_key ?? "").trim();
                  const meta = playlistMeta[key] ?? null;
                  const name = meta?.name ?? key;
                  const imgUrl = meta?.imageUrl ?? null;

                  return (
                    <div className="flex items-center gap-2 min-w-0">
                      {imgUrl ? (
                        <PreviewableArtwork
                          src={imgUrl}
                          alt=""
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded object-cover sb-ring flex-shrink-0"
                          label={name}
                        />
                      ) : (
                        <div className="h-8 w-8 rounded sb-ring bg-white/60 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/playlists?playlist_key=${encodeURIComponent(key)}`}
                          className="font-medium hover:underline block truncate"
                          style={{ color: "var(--sb-text)" }}
                          title={name}
                        >
                          {name}
                        </Link>
                        <div className="text-[10px] opacity-60 truncate" title={key}>
                          {key}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell numeric>{(r.rows_count as number) ?? null}</TableCell>
              <TableCell numeric mono className="text-xs">
                {r.exported_at ? new Date(r.exported_at as string).toLocaleString() : null}
              </TableCell>
              <TableCell>
                {r.storage_bucket && r.object_key ? (
                  <a
                    className="underline"
                    href={`/exports?bucket=${encodeURIComponent(r.storage_bucket as string)}&key=${encodeURIComponent(r.object_key as string)}`}
                  >
                    csv
                  </a>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          {!shell.exportsForLatest.length && (
            <EmptyState colSpan={4} message="No raw exports found for this run." />
          )}
        </GlassTable>
      </CollapsibleSection>
    </div>
  );
}
