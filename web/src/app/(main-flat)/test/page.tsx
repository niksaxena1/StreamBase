import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { formatDateISO } from "@/lib/format";
import { Alert } from "@/components/ui/Alert";
import { PageHeader } from "@/components/shell/PageHeader";
import { TestExperimentsClient } from "./TestExperimentsClient";
import type { TestDailyRow, TestPlaylistLabel, TestRunRow, TestSankeyRow } from "./testTypes";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chart experiments",
  robots: { index: false, follow: false },
};

export default async function TestExperimentsPage() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const svc = supabaseService();

  const [{ data: histRaw, error: histErr }, { data: runsRaw, error: runsErr }, { data: plRaw, error: plErr }] =
    await Promise.all([
      svc
        .from("playlist_daily_stats")
        .select("date,daily_streams_net,total_streams_cumulative,track_count")
        .eq("playlist_key", "all_catalog")
        .order("date", { ascending: true })
        .limit(500),
      svc
        .from("ingestion_runs")
        .select("run_date,status,started_at,finished_at")
        .order("run_date", { ascending: false })
        .limit(45),
      svc
        .from("playlists")
        .select("playlist_key,display_name,is_catalog,playlist_type,collector")
        .order("display_order", { ascending: true, nullsFirst: false }),
    ]);

  if (histErr) console.error("test page playlist_daily_stats:", histErr);
  if (runsErr) console.error("test page ingestion_runs:", runsErr);
  if (plErr) console.error("test page playlists:", plErr);

  const history: TestDailyRow[] = (histRaw ?? []).map((r) => ({
    date: String(r.date ?? "").slice(0, 10),
    daily: r.daily_streams_net != null ? Number(r.daily_streams_net) : null,
    total: r.total_streams_cumulative != null ? Number(r.total_streams_cumulative) : null,
    track_count: r.track_count != null ? Number(r.track_count) : null,
  }));

  const runs: TestRunRow[] = (runsRaw ?? []).map((r) => ({
    run_date: String(r.run_date ?? "").slice(0, 10),
    status: r.status != null ? String(r.status) : null,
    started_at: r.started_at != null ? String(r.started_at) : null,
    finished_at: r.finished_at != null ? String(r.finished_at) : null,
  }));

  const playlists: TestPlaylistLabel[] = (plRaw ?? [])
    .map((p) => ({
      playlist_key: String(p.playlist_key ?? ""),
      display_name: String(p.display_name ?? p.playlist_key ?? "").trim() || String(p.playlist_key ?? ""),
    }))
    .filter((p) => p.playlist_key);

  const latestDate = history.length > 0 ? history[history.length - 1].date : null;
  const prevDate = history.length > 1 ? history[history.length - 2].date : null;
  const sankeyPlaylistRows = (plRaw ?? [])
    .map((p) => ({
      playlist_key: String(p.playlist_key ?? ""),
      playlist_name: String(p.display_name ?? p.playlist_key ?? "").trim() || String(p.playlist_key ?? ""),
      collector: p.collector != null ? String(p.collector).trim() : "",
      playlist_type: p.playlist_type != null ? String(p.playlist_type).trim() : "",
      is_catalog: Boolean(p.is_catalog),
    }))
    .filter((p) => p.playlist_key && p.playlist_key !== "all_catalog" && !p.is_catalog)
    .slice(0, 8);

  const sankeySettled =
    latestDate != null
      ? await Promise.allSettled(
          sankeyPlaylistRows.map((p) =>
            svc.rpc("playlist_top_tracks", {
              playlist_key: p.playlist_key,
              run_date: latestDate,
              prev_date: prevDate,
              limit_rows: 24,
            }),
          ),
        )
      : [];

  const sankeyRows: TestSankeyRow[] = [];
  const sankeyErrors: string[] = [];
  sankeySettled.forEach((result, idx) => {
    const playlist = sankeyPlaylistRows[idx];
    if (!playlist) return;
    if (result.status === "rejected") {
      sankeyErrors.push(`${playlist.playlist_name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      return;
    }
    if (result.value.error) {
      sankeyErrors.push(`${playlist.playlist_name}: ${result.value.error.message}`);
      return;
    }
    const groupName = playlist.collector || playlist.playlist_type || "Organizing playlists";
    const groupKey = groupName.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "organizing_playlists";
    for (const row of result.value.data ?? []) {
      const daily = row.daily != null ? Number(row.daily) : null;
      const total = row.total != null ? Number(row.total) : null;
      const value = daily != null && daily > 0 ? daily : total != null && total > 0 ? total : 0;
      if (!Number.isFinite(value) || value <= 0) continue;
      sankeyRows.push({
        group_key: groupKey,
        group_name: groupName,
        playlist_key: playlist.playlist_key,
        playlist_name: playlist.playlist_name,
        isrc: String(row.isrc ?? ""),
        track_name: String(row.name ?? row.isrc ?? "").trim() || String(row.isrc ?? ""),
        artist_names: Array.isArray(row.artist_names) ? row.artist_names.map((a: unknown) => String(a)) : [],
        value,
        total,
        daily,
      });
    }
  });

  const realRowCount = history.length;
  const realFirst = realRowCount > 0 ? history[0].date : null;
  const realLast = realRowCount > 0 ? history[history.length - 1].date : null;

  const loadErrors: string[] = [];
  if (histErr?.message) loadErrors.push(`playlist_daily_stats (all_catalog): ${histErr.message}`);
  if (runsErr?.message) loadErrors.push(`ingestion_runs: ${runsErr.message}`);
  if (plErr?.message) loadErrors.push(`playlists: ${plErr.message}`);
  for (const err of sankeyErrors) loadErrors.push(`catalog grouping flow: ${err}`);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-24">
      <PageHeader
        title="Chart experiments"
        subtitle="Internal preview only — not linked in nav. Compare concepts; data labeled Live vs mock per section."
      />
      {loadErrors.length > 0 ? (
        <div className="-mt-2 mb-4">
          <Alert variant="error" title="Some test-page queries failed">
            <ul className="list-disc space-y-0.5 pl-4">
              {loadErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}
      {realRowCount > 0 ? (
        <p className="-mt-2 mb-4 text-xs" style={{ color: "var(--sb-muted)" }}>
          Live <code className="text-[11px]">all_catalog</code> rows loaded:{" "}
          <span style={{ color: "var(--sb-text)" }}>{realRowCount}</span>
          {" · "}
          {formatDateISO(realFirst)} → {formatDateISO(realLast)}
        </p>
      ) : histErr ? (
        <p className="-mt-2 mb-4 text-xs" style={{ color: "var(--sb-muted)" }}>
          <code className="text-[11px]">all_catalog</code> could not be loaded. Charts use generated series where noted.
        </p>
      ) : (
        <p className="-mt-2 mb-4 text-xs" style={{ color: "var(--sb-warning, #b45309)" }}>
          No <code className="text-[11px]">all_catalog</code> rows returned; chart sections fall back to generated series where noted.
        </p>
      )}
      <TestExperimentsClient
        history={history}
        runs={runs}
        playlists={playlists}
        sankeyRows={sankeyRows}
        sankeyAsOfDate={latestDate}
      />
    </div>
  );
}
