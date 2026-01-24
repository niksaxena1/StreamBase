import Link from "next/link";
import { Activity } from "lucide-react";

import { formatDateISO } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { DatePicker } from "@/components/ui/DatePicker";

export const dynamic = "force-dynamic";

function FilterToggle({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-full px-3 py-2 text-xs font-medium transition",
        active
          ? "bg-black text-white shadow-sm"
          : "bg-white/70 text-black/70 hover:bg-white",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

export default async function HealthPage({
  searchParams,
}: {
  searchParams?: Promise<{ severity?: string; playlist?: string; date?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const severityFilter = sp.severity ?? "all";
  const playlistFilter = sp.playlist ?? "all";
  const dateFilter = sp.date;

  const sb = await supabaseServer();

  const { data: runs, error: runsErr } = await sb
    .from("ingestion_runs")
    .select("id,run_date,status,logs_url,started_at,finished_at")
    .order("run_date", { ascending: false })
    .limit(30);

  // Determine which date to show (from filter or latest)
  const latestDate = runs?.[0]?.run_date ?? null;
  const selectedDate = dateFilter ?? latestDate;

  // Get run ID for selected date
  const selectedRun = runs?.find((r) => r.run_date === selectedDate);
  const selectedRunId = selectedRun?.id ?? null;

  const { data: exportsForLatest, error: exportsErr } = selectedRunId
    ? await sb
        .from("raw_exports")
        .select("playlist_key,storage_bucket,object_key,rows_count,file_sha256,exported_at")
        .eq("run_id", selectedRunId)
        .order("playlist_key", { ascending: true })
    : { data: [], error: null };

  // Get all playlists for filter dropdown
  const { data: allPlaylists } = await sb
    .from("playlists")
    .select("playlist_key,display_name")
    .order("display_name", { ascending: true });

  // Build warnings query with filters
  let warningsQuery = sb
    .from("ingestion_warnings")
    .select("severity,code,playlist_key,message,run_date")
    .order("severity", { ascending: false })
    .order("playlist_key", { ascending: true });

  if (selectedDate) {
    warningsQuery = warningsQuery.eq("run_date", selectedDate);
  }

  if (severityFilter !== "all") {
    warningsQuery = warningsQuery.eq("severity", severityFilter);
  }

  if (playlistFilter !== "all") {
    warningsQuery = warningsQuery.eq("playlist_key", playlistFilter);
  }

  const { data: warnings, error: warnErr } = await warningsQuery.limit(200);

  // Build filter URLs
  function hrefWith(patch: { severity?: string; playlist?: string; date?: string }) {
    const u = new URL("https://example.com/");
    const severity = patch.severity ?? severityFilter;
    const playlist = patch.playlist ?? playlistFilter;
    const date = patch.date ?? dateFilter;
    if (severity !== "all") u.searchParams.set("severity", severity);
    if (playlist !== "all") u.searchParams.set("playlist", playlist);
    if (date) u.searchParams.set("date", date);
    return `${u.pathname}?${u.searchParams.toString()}`;
  }

  // Get date range for picker
  const firstDate = runs?.[runs.length - 1]?.run_date ?? selectedDate ?? new Date().toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">System Health</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--sb-muted)" }}>
            Recent ingestion runs and anomaly warnings.
          </p>
        </div>
        <div className="rounded-full bg-white/50 p-3 backdrop-blur-md dark:bg-white/5">
          <Activity className="h-6 w-6 opacity-70" />
        </div>
      </div>

      {(runsErr || warnErr || exportsErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error:{" "}
          {runsErr?.message ??
            exportsErr?.message ??
            warnErr?.message ??
            "unknown error"}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="sb-ring flex items-center gap-1 rounded-full bg-white/70 p-1 text-sm">
          <FilterToggle active={severityFilter === "all"} href={hrefWith({ severity: "all" })}>
            All
          </FilterToggle>
          <FilterToggle active={severityFilter === "critical"} href={hrefWith({ severity: "critical" })}>
            Critical
          </FilterToggle>
          <FilterToggle active={severityFilter === "warn"} href={hrefWith({ severity: "warn" })}>
            Warn
          </FilterToggle>
          <FilterToggle active={severityFilter === "info"} href={hrefWith({ severity: "info" })}>
            Info
          </FilterToggle>
        </div>

        <div className="sb-ring flex items-center gap-1 rounded-full bg-white/70 p-1 text-sm">
          <FilterToggle active={playlistFilter === "all"} href={hrefWith({ playlist: "all" })}>
            All Playlists
          </FilterToggle>
          {(allPlaylists ?? []).slice(0, 5).map((p) => (
            <FilterToggle
              key={p.playlist_key}
              active={playlistFilter === p.playlist_key}
              href={hrefWith({ playlist: p.playlist_key })}
            >
              {p.display_name}
            </FilterToggle>
          ))}
        </div>

        <DatePicker
          value={selectedDate ?? today}
          min={firstDate}
          max={today}
          label="Run date"
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <Activity className="h-4 w-4 opacity-50" />
          <h2 className="text-lg font-semibold">Ingestion Runs (30d)</h2>
        </div>
        <GlassTable headers={["Run Date", "Status", "Logs"]}>
          {(runs ?? []).map((r) => (
            <TableRow key={r.run_date}>
              <TableCell mono>{formatDateISO(r.run_date)}</TableCell>
              <TableCell>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    background:
                      r.status === "success"
                        ? "rgba(199, 243, 60, 0.2)"
                        : "rgba(0,0,0,0.06)",
                    color: r.status === "success" ? "#4d6600" : "inherit",
                  }}
                >
                  {r.status}
                </span>
              </TableCell>
              <TableCell>
                {r.logs_url ? (
                  <a
                    className="underline"
                    href={r.logs_url}
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
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={3}>
                No ingestion runs yet.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-semibold">
            Raw Exports {selectedDate ? <span className="text-sm font-normal opacity-60">({selectedDate})</span> : null}
          </h2>
          <span className="text-xs opacity-50">Signed links (60s)</span>
        </div>
        <GlassTable headers={["Playlist", "Rows", "Exported", "Download"]}>
          {(exportsForLatest ?? []).map((r) => (
            <TableRow key={r.playlist_key}>
              <TableCell mono className="text-xs">
                {r.playlist_key}
              </TableCell>
              <TableCell>{r.rows_count ?? "—"}</TableCell>
              <TableCell mono className="text-xs">
                {r.exported_at ? new Date(r.exported_at).toLocaleString() : "—"}
              </TableCell>
              <TableCell>
                {r.storage_bucket && r.object_key ? (
                  <a
                    className="underline"
                    href={`/exports?bucket=${encodeURIComponent(r.storage_bucket)}&key=${encodeURIComponent(r.object_key)}`}
                  >
                    csv
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
            </TableRow>
          ))}
          {!exportsForLatest?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No raw exports found for this run.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-semibold">
            Warnings {selectedDate ? <span className="text-sm font-normal opacity-60">({selectedDate})</span> : null}
          </h2>
          <Link className="text-xs underline opacity-60" href="/playlists">
            View playlists
          </Link>
        </div>
        <GlassTable headers={["Severity", "Code", "Playlist", "Message"]}>
          {(warnings ?? []).map((w, i) => (
            <TableRow key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}>
              <TableCell>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={{
                    background:
                      w.severity === "critical"
                        ? "rgba(239, 68, 68, 0.2)"
                        : w.severity === "warn"
                          ? "rgba(245, 158, 11, 0.2)"
                          : "rgba(59, 130, 246, 0.2)",
                    color:
                      w.severity === "critical"
                        ? "#991b1b"
                        : w.severity === "warn"
                          ? "#92400e"
                          : "#1e40af",
                  }}
                >
                  {w.severity}
                </span>
              </TableCell>
              <TableCell mono className="text-xs">
                {w.code}
              </TableCell>
              <TableCell>
                {w.playlist_key ? (
                  <Link
                    href={`/playlists/${w.playlist_key}`}
                    className="font-mono text-xs underline transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {w.playlist_key}
                  </Link>
                ) : (
                  <span className="font-mono text-xs opacity-30">—</span>
                )}
              </TableCell>
              <TableCell>{w.message}</TableCell>
            </TableRow>
          ))}
          {!warnings?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No warnings found for the selected filters.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    </div>
  );
}

