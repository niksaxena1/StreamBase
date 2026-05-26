import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { formatDateISO, formatInt } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { addDaysISO, dataDateFromRunDate, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import type { PlaylistMeta } from "@/lib/health/types";

import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { RefreshButton } from "@/components/health/RefreshButton";
import { WarningHistoryChart } from "@/components/health/WarningHistoryChart";
import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

import { WarningsSection } from "@/components/health/WarningsSection";
import { MissingCatalogSection } from "@/components/health/MissingCatalogSection";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Health",
};

type HealthPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type CompetitorPlaylistRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  is_active: boolean;
};

type CompetitorStatRow = {
  date: string;
  playlist_key: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  missing_streams_track_count: number | null;
};

type CompetitorExportRow = {
  playlist_key: string;
  rows_count: number | null;
  exported_at: string | null;
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

async function CompetitorHealthPage({
  svc,
}: {
  svc: ReturnType<typeof supabaseService>;
}) {
  const comp = svc.schema("competitor");
  const [
    { data: runsRaw, error: runsErr },
    { data: playlistsRaw },
    { data: statsRaw },
    { data: exportsRaw },
    { data: warningsRaw },
    { count: unenrichedCount },
  ] = await Promise.all([
    comp
      .from("ingestion_runs")
      .select("id,run_date,status,started_at,finished_at")
      .order("run_date", { ascending: false })
      .limit(14),
    comp
      .from("playlists")
      .select("playlist_key,label_key,display_name,spotify_playlist_image_url,is_active")
      .order("label_key", { ascending: true })
      .order("display_order", { ascending: true, nullsFirst: false }),
    comp
      .from("playlist_daily_stats")
      .select("date,playlist_key,track_count,total_streams_cumulative,daily_streams_net,missing_streams_track_count")
      .order("date", { ascending: false })
      .limit(300),
    comp
      .from("raw_exports")
      .select("playlist_key,rows_count,exported_at")
      .order("exported_at", { ascending: false })
      .limit(300),
    comp
      .from("ingestion_warnings")
      .select("playlist_key,severity,code,message,created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    comp
      .from("tracks")
      .select("isrc", { count: "exact", head: true })
      .or("spotify_artist_ids.is.null,spotify_album_image_url.is.null"),
  ]);

  const runs = (runsRaw ?? []) as Array<Record<string, unknown>>;
  const playlists = (playlistsRaw ?? []) as CompetitorPlaylistRow[];
  const stats = (statsRaw ?? []) as CompetitorStatRow[];
  const exportsRows = (exportsRaw ?? []) as CompetitorExportRow[];
  const latestRunDate = (runs[0]?.run_date as string | undefined) ?? null;

  const latestStatByPlaylist = new Map<string, CompetitorStatRow>();
  for (const stat of stats) {
    if (!latestStatByPlaylist.has(stat.playlist_key)) latestStatByPlaylist.set(stat.playlist_key, stat);
  }
  const previousStatByPlaylist = new Map<string, CompetitorStatRow>();
  for (const stat of stats) {
    if (latestStatByPlaylist.get(stat.playlist_key)?.date === stat.date) continue;
    if (!previousStatByPlaylist.has(stat.playlist_key)) previousStatByPlaylist.set(stat.playlist_key, stat);
  }
  const latestExportByPlaylist = new Map<string, CompetitorExportRow>();
  for (const row of exportsRows) {
    if (!latestExportByPlaylist.has(row.playlist_key)) latestExportByPlaylist.set(row.playlist_key, row);
  }

  const failedRuns = runs.filter((run) => run.status !== "success").length;
  const missingTotals = [...latestStatByPlaylist.values()].reduce(
    (sum, stat) => sum + Number(stat.missing_streams_track_count ?? 0),
    0,
  );
  const activePlaylists = playlists.filter((playlist) => playlist.is_active !== false);
  const stalePlaylists = activePlaylists.filter((playlist) => latestStatByPlaylist.get(playlist.playlist_key)?.date !== latestRunDate);
  const rowMismatches = activePlaylists.filter((playlist) => {
    const stat = latestStatByPlaylist.get(playlist.playlist_key);
    const exp = latestExportByPlaylist.get(playlist.playlist_key);
    return stat?.track_count != null && exp?.rows_count != null && Number(stat.track_count) !== Number(exp.rows_count);
  });
  const warningCount = (warningsRaw ?? []).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitor Health"
        subtitle={
          latestRunDate
            ? `Competitor pipeline checks. Last ingested: ${formatDateISO(dataDateFromRunDate(latestRunDate))}`
            : "Competitor pipeline checks."
        }
        actions={<RefreshButton />}
      />

      {runsErr ? (
        <Alert variant="error" title="Query error">
          {runsErr.message}
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-5">
        {[
          ["Failed runs", failedRuns],
          ["Stale playlists", stalePlaylists.length],
          ["Row mismatches", rowMismatches.length],
          ["Missing totals", missingTotals],
          ["Unenriched tracks", unenrichedCount ?? 0],
        ].map(([label, value]) => (
          <div key={label} className="sb-card p-4">
            <div className="text-[11px] uppercase tracking-wider opacity-60">{label}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{formatInt(Number(value ?? 0))}</div>
          </div>
        ))}
      </div>

      <CollapsibleSection title="Playlist Checks" storageKey="sb:health:competitor:playlist_checks">
        <GlassTable headers={["Playlist", "Latest", "Tracks", "Rows", "Daily", "Missing totals", "Status"]}>
          {activePlaylists.map((playlist) => {
            const stat = latestStatByPlaylist.get(playlist.playlist_key);
            const prev = previousStatByPlaylist.get(playlist.playlist_key);
            const exportRow = latestExportByPlaylist.get(playlist.playlist_key);
            const stale = stat?.date !== latestRunDate;
            const rowMismatch =
              stat?.track_count != null && exportRow?.rows_count != null && Number(stat.track_count) !== Number(exportRow.rows_count);
            const swing =
              stat?.track_count != null && prev?.track_count != null
                ? Number(stat.track_count) - Number(prev.track_count)
                : 0;
            const bad = stale || rowMismatch || Number(stat?.missing_streams_track_count ?? 0) > 0;
            return (
              <TableRow key={playlist.playlist_key}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    {playlist.spotify_playlist_image_url ? (
                      <PreviewableArtwork
                        src={playlist.spotify_playlist_image_url}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 flex-shrink-0 rounded object-cover sb-ring"
                        label={playlist.display_name}
                      />
                    ) : (
                      <div className="h-8 w-8 flex-shrink-0 rounded bg-white/10 sb-ring" />
                    )}
                    <div className="min-w-0">
                      <Link href={`/playlists?playlist_key=${encodeURIComponent(playlist.playlist_key)}`} className="block truncate font-medium hover:underline">
                        {playlist.display_name}
                      </Link>
                      <div className="truncate text-[10px] opacity-60">{playlist.label_key}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell mono>{stat?.date ? formatDateISO(dataDateFromRunDate(stat.date)) : "—"}</TableCell>
                <TableCell numeric>
                  {stat?.track_count == null ? "—" : formatInt(stat.track_count)}
                  {swing ? <span className={swing > 0 ? "ml-1 text-lime-500" : "ml-1 text-red-500"}>({swing > 0 ? "+" : ""}{formatInt(swing)})</span> : null}
                </TableCell>
                <TableCell numeric className={rowMismatch ? "text-amber-500" : ""}>
                  {exportRow?.rows_count == null ? "—" : formatInt(exportRow.rows_count)}
                </TableCell>
                <TableCell numeric>{stat?.daily_streams_net == null ? "—" : formatInt(stat.daily_streams_net)}</TableCell>
                <TableCell numeric>{stat?.missing_streams_track_count == null ? "—" : formatInt(stat.missing_streams_track_count)}</TableCell>
                <TableCell>
                  <span className={[
                    "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                    bad ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "bg-lime-500/20 text-lime-700 dark:text-lime-300",
                  ].join(" ")}>
                    {bad ? "check" : "ok"}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
          {!activePlaylists.length ? <EmptyState colSpan={7} message="No competitor playlists configured." /> : null}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection title="Competitor Ingestion Runs" storageKey="sb:health:competitor:ingestion_runs">
        <GlassTable headers={["Run Date", "Status", "Started", "Finished"]}>
          {runs.map((run) => (
            <TableRow key={run.run_date as string}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(run.run_date as string))}</TableCell>
              <TableCell>{String(run.status ?? "—")}</TableCell>
              <TableCell mono>{run.started_at ? new Date(run.started_at as string).toLocaleString() : "—"}</TableCell>
              <TableCell mono>{run.finished_at ? new Date(run.finished_at as string).toLocaleString() : "—"}</TableCell>
            </TableRow>
          ))}
          {!runs.length ? <EmptyState colSpan={4} message="No competitor ingestion runs yet." /> : null}
        </GlassTable>
      </CollapsibleSection>

      <CollapsibleSection title={`Recent Competitor Warnings (${warningCount})`} storageKey="sb:health:competitor:warnings">
        <GlassTable headers={["Created", "Playlist", "Severity", "Code", "Message"]}>
          {((warningsRaw ?? []) as Array<Record<string, unknown>>).map((warning, idx) => (
            <TableRow key={`${warning.created_at}-${idx}`}>
              <TableCell mono>{warning.created_at ? new Date(warning.created_at as string).toLocaleString() : "—"}</TableCell>
              <TableCell>{String(warning.playlist_key ?? "—")}</TableCell>
              <TableCell>{String(warning.severity ?? "—")}</TableCell>
              <TableCell mono>{String(warning.code ?? "—")}</TableCell>
              <TableCell>{String(warning.message ?? "—")}</TableCell>
            </TableRow>
          ))}
          {!warningCount ? <EmptyState colSpan={5} message="No competitor warnings." /> : null}
        </GlassTable>
      </CollapsibleSection>
    </div>
  );
}

export default async function HealthPage({ searchParams }: HealthPageProps) {
  const sp = (await searchParams) ?? {};
  const getFirst = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const dateFilter = getFirst(sp.date);
  const pageParam = Math.max(1, parseInt(getFirst(sp.page) ?? "1", 10) || 1);
  const viewParamRaw = getFirst(sp.view);
  const warningView =
    viewParamRaw === "resolved" || viewParamRaw === "all"
      ? viewParamRaw
      : "active";

  // ---- Auth ----
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  // ---- Lightweight queries (fast) ----
  const svc = supabaseService();

  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (normalizeDatasetMode(settings?.dataset_mode) === "competitor") {
    return <CompetitorHealthPage svc={svc} />;
  }

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
          view={warningView}
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
