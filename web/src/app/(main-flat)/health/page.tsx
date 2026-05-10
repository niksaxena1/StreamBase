import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { formatDateISO } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import type { PlaylistMeta } from "@/lib/health/types";

import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { RefreshButton } from "@/components/health/RefreshButton";
import { WarningHistoryChart } from "@/components/health/WarningHistoryChart";
import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

import { WarningsSection } from "@/components/health/WarningsSection";
import { MissingCatalogSection } from "@/components/health/MissingCatalogSection";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Health",
};

type HealthPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HealthPage({ searchParams }: HealthPageProps) {
  const sp = (await searchParams) ?? {};
  const getFirst = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const dateFilter = getFirst(sp.date);
  const pageParam = Math.max(1, parseInt(getFirst(sp.page) ?? "1", 10) || 1);

  // ---- Auth ----
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  // ---- Lightweight queries (fast) ----
  const svc = supabaseService();

  const [{ data: runs, error: runsErr }, { data: plRows }, { data: healthConfigRows }] = await Promise.all([
    svc
      .from("ingestion_runs")
      .select("id,run_date,status,logs_url,started_at,finished_at")
      .order("run_date", { ascending: false })
      .limit(30),
    svc
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url")
      .limit(2000),
    svc
      .from("health_config")
      .select("key,value_numeric,description,updated_at")
      .order("key", { ascending: true })
      .limit(100),
  ]);

  // Build playlist metadata lookup
  const playlistMeta: Record<string, PlaylistMeta> = {};
  for (const r of (plRows ?? []) as Array<Record<string, unknown>>) {
    const key = String(r.playlist_key ?? "").trim();
    if (!key) continue;
    playlistMeta[key] = {
      name: String(r.display_name ?? "").trim() || key,
      imageUrl: (r.spotify_playlist_image_url ?? null) as string | null,
    };
  }

  // ---- Resolve dates ----
  const latestRunDate = (runs?.[0] as Record<string, unknown> | undefined)?.run_date as string | null ?? null;
  const latestDataDate = latestRunDate
    ? dataDateFromRunDate(latestRunDate)
    : null;
  const selectedDataDate = dateFilter ?? latestDataDate;
  const selectedRunDate = selectedDataDate
    ? addDaysISO(selectedDataDate, SOT_DATA_LAG_DAYS)
    : latestRunDate;

  // ---- Exports for selected run ----
  const selectedRun = runs?.find(
    (r: Record<string, unknown>) => r.run_date === selectedRunDate,
  ) as Record<string, unknown> | undefined;
  const selectedRunId = (selectedRun?.id as string) ?? null;

  const { data: exportsForLatest, error: exportsErr } = selectedRunId
    ? await svc
        .from("raw_exports")
        .select(
          "playlist_key,storage_bucket,object_key,rows_count,file_sha256,exported_at",
        )
        .eq("run_id", selectedRunId)
        .order("playlist_key", { ascending: true })
    : { data: [], error: null };

  // ---- Skeleton components for Suspense fallbacks ----
  const WarningSkeleton = () => (
    <div className="space-y-2">
      <div className="h-5 w-48 rounded bg-white/10 animate-pulse" />
      <div className="sb-card p-4 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />
        ))}
      </div>
    </div>
  );

  const MissingSkeleton = () => (
    <div className="space-y-2">
      <div className="h-5 w-64 rounded bg-white/10 animate-pulse" />
      <div className="sb-card p-4 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 rounded bg-white/5 animate-pulse" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="System Health"
        subtitle={
          latestRunDate
            ? `Recent ingestion runs and anomaly warnings. Last ingested: ${dataDateFromRunDate(latestRunDate)}`
            : "Recent ingestion runs and anomaly warnings."
        }
        actions={<RefreshButton />}
      />

      {(runsErr || exportsErr) && (
        <Alert variant="error" title="Query error">
          {runsErr?.message ?? exportsErr?.message ?? "unknown error"}
        </Alert>
      )}

      {/* --- Warnings table (heavy — streams via Suspense) --- */}
      <Suspense fallback={<WarningSkeleton />}>
        <WarningsSection
          runDate={selectedRunDate}
          dataDate={selectedDataDate}
          playlistMeta={playlistMeta}
          page={pageParam}
          dateParam={dateFilter ?? null}
        />
      </Suspense>

      {/* --- History chart (client component, self-fetching) --- */}
      <WarningHistoryChart />

      {/* --- Missing catalog tracks (medium — own Suspense) --- */}
      <Suspense fallback={<MissingSkeleton />}>
        <MissingCatalogSection
          runDate={selectedRunDate}
          dataDate={selectedDataDate}
        />
      </Suspense>

      {/* --- Ingestion Runs (data already available) --- */}
      <CollapsibleSection
        title="Ingestion Runs (30d)"
        storageKey="sb:health:details:ingestion_runs"
      >
        <GlassTable
          headers={["Run Date", "Status", "Logs"]}
          maxBodyHeightClassName="max-h-[260px]"
        >
          {(runs ?? []).map((r: Record<string, unknown>) => (
            <TableRow key={r.run_date as string}>
              <TableCell mono>
                {formatDateISO(dataDateFromRunDate(r.run_date as string))}
              </TableCell>
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
                  <a
                    className="underline"
                    href={r.logs_url as string}
                    target="_blank"
                    rel="noreferrer"
                  >
                    open
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
          {!runs?.length && (
            <EmptyState colSpan={3} message="No ingestion runs yet." />
          )}
        </GlassTable>
      </CollapsibleSection>

      {/* --- Ingestion Thresholds (health_config) --- */}
      <CollapsibleSection
        title="Ingestion Thresholds"
        storageKey="sb:health:details:ingestion_thresholds"
      >
        {healthConfigRows && healthConfigRows.length > 0 ? (
          <GlassTable headers={["Key", { label: "Value", align: "right" as const }, "Description"]}>
            {(healthConfigRows as Array<Record<string, unknown>>).map((r) => (
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
                <TableCell className="text-xs opacity-70">
                  {r.description as string}
                </TableCell>
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

      {/* --- Raw Exports (data already available) --- */}
      <CollapsibleSection
        title={
          <>
            Raw Exports{" "}
            {selectedDataDate ? (
              <span className="text-[10px] font-normal normal-case tracking-normal opacity-40">
                ({selectedDataDate})
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
          {((exportsForLatest ?? []) as Array<Record<string, unknown>>).map(
            (r) => (
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
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imgUrl}
                            alt=""
                            className="h-8 w-8 rounded object-cover sb-ring flex-shrink-0"
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
                          <div
                            className="text-[10px] opacity-60 truncate"
                            title={key}
                          >
                            {key}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell numeric>
                  {(r.rows_count as number) ?? null}
                </TableCell>
                <TableCell numeric mono className="text-xs">
                  {r.exported_at
                    ? new Date(r.exported_at as string).toLocaleString()
                    : null}
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
            ),
          )}
          {!exportsForLatest?.length && (
            <EmptyState
              colSpan={4}
              message="No raw exports found for this run."
            />
          )}
        </GlassTable>
      </CollapsibleSection>
    </div>
  );
}
