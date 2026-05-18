import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { PageHeader } from "@/components/shell/PageHeader";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { formatDateISO, formatInt } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Competitors",
};

type LabelRow = {
  label_key: string;
  display_name: string;
  is_active: boolean;
};

type PlaylistRow = {
  playlist_key: string;
  label_key: string;
  display_name: string;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  sot_playlist_id: number | null;
  sot_dashboard_url: string;
  display_order: number | null;
  is_active: boolean;
};

type PlaylistStatRow = {
  date: string;
  playlist_key: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  missing_streams_track_count: number | null;
};

type RawExportRow = {
  playlist_key: string;
  rows_count: number;
  exported_at: string;
};

type MembershipRow = {
  playlist_key: string;
  isrc: string;
};

type TrackRow = {
  isrc: string;
  spotify_artist_ids: string[] | null;
  spotify_album_image_url: string | null;
};

function fmtMaybeDate(value: string | null | undefined) {
  return value ? formatDateISO(value.slice(0, 10)) : "—";
}

export default async function CompetitorsPage() {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (!isAdmin) redirect("/");

  const svc = supabaseService();
  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (normalizeDatasetMode(settings?.dataset_mode) !== "competitor") redirect("/");

  const comp = svc.schema("competitor");
  const [
    { data: labelsRaw },
    { data: playlistsRaw },
    { data: recentStatsRaw },
    { data: rawExportsRaw },
    { data: latestRun },
    { data: warningRowsRaw },
  ] = await Promise.all([
    comp.from("labels").select("label_key,display_name,is_active").order("display_name", { ascending: true }),
    comp
      .from("playlists")
      .select("playlist_key,label_key,display_name,spotify_playlist_id,spotify_playlist_image_url,sot_playlist_id,sot_dashboard_url,display_order,is_active")
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true }),
    comp
      .from("playlist_daily_stats")
      .select("date,playlist_key,track_count,total_streams_cumulative,missing_streams_track_count")
      .order("date", { ascending: false }),
    comp
      .from("raw_exports")
      .select("playlist_key,rows_count,exported_at")
      .order("exported_at", { ascending: false }),
    comp
      .from("ingestion_runs")
      .select("run_date,status,started_at,finished_at")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    comp
      .from("ingestion_warnings")
      .select("playlist_key,severity")
      .order("created_at", { ascending: false }),
  ]);

  const labels = (labelsRaw ?? []) as LabelRow[];
  const playlists = (playlistsRaw ?? []) as PlaylistRow[];
  const stats = (recentStatsRaw ?? []) as PlaylistStatRow[];
  const rawExports = (rawExportsRaw ?? []) as RawExportRow[];
  const latestRunDate = (latestRun as { run_date?: string | null } | null)?.run_date ?? null;

  const latestStatByPlaylist = new Map<string, PlaylistStatRow>();
  for (const stat of stats) {
    if (!latestStatByPlaylist.has(stat.playlist_key)) latestStatByPlaylist.set(stat.playlist_key, stat);
  }

  const latestExportByPlaylist = new Map<string, RawExportRow>();
  for (const row of rawExports) {
    if (!latestExportByPlaylist.has(row.playlist_key)) latestExportByPlaylist.set(row.playlist_key, row);
  }

  const warningCountByPlaylist = new Map<string, number>();
  for (const row of (warningRowsRaw ?? []) as Array<{ playlist_key: string | null; severity: string }>) {
    if (!row.playlist_key) continue;
    warningCountByPlaylist.set(row.playlist_key, (warningCountByPlaylist.get(row.playlist_key) ?? 0) + 1);
  }

  const { data: currentMembershipsRaw } = latestRunDate
    ? await comp
        .from("playlist_memberships")
        .select("playlist_key,isrc")
        .lte("valid_from", latestRunDate)
        .or(`valid_to.is.null,valid_to.gte.${latestRunDate}`)
    : { data: [] };
  const currentMemberships = (currentMembershipsRaw ?? []) as MembershipRow[];
  const activeIsrcs = [...new Set(currentMemberships.map((row) => row.isrc))];
  const { data: activeTracksRaw } = activeIsrcs.length
    ? await comp.from("tracks").select("isrc,spotify_artist_ids,spotify_album_image_url").in("isrc", activeIsrcs)
    : { data: [] };
  const activeTrackByIsrc = new Map(((activeTracksRaw ?? []) as TrackRow[]).map((row) => [row.isrc, row]));

  const activeMembershipsByPlaylist = new Map<string, MembershipRow[]>();
  for (const membership of currentMemberships) {
    const rows = activeMembershipsByPlaylist.get(membership.playlist_key) ?? [];
    rows.push(membership);
    activeMembershipsByPlaylist.set(membership.playlist_key, rows);
  }

  const playlistsByLabel = new Map<string, PlaylistRow[]>();
  for (const playlist of playlists) {
    const rows = playlistsByLabel.get(playlist.label_key) ?? [];
    rows.push(playlist);
    playlistsByLabel.set(playlist.label_key, rows);
  }

  const summary = labels.map((label) => {
    const rows = playlistsByLabel.get(label.label_key) ?? [];
    const statsForLabel = rows.map((playlist) => latestStatByPlaylist.get(playlist.playlist_key)).filter(Boolean) as PlaylistStatRow[];
    const memberships = rows.flatMap((playlist) => activeMembershipsByPlaylist.get(playlist.playlist_key) ?? []);
    const unenrichedTracks = memberships.filter((membership) => {
      const track = activeTrackByIsrc.get(membership.isrc);
      return !track?.spotify_artist_ids?.length;
    }).length;
    return {
      label,
      playlists: rows,
      trackCount: statsForLabel.reduce((sum, stat) => sum + Number(stat.track_count ?? 0), 0),
      totalStreams: statsForLabel.reduce((sum, stat) => sum + Number(stat.total_streams_cumulative ?? 0), 0),
      unenrichedTracks,
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitors"
        subtitle={
          latestRunDate
            ? <>Latest competitor run: <span className="font-mono">{formatDateISO(dataDateFromRunDate(latestRunDate))}</span></>
            : "No competitor ingestion run found yet."
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        {summary.map(({ label, playlists: labelPlaylists, trackCount, totalStreams, unenrichedTracks }) => {
          const imageUrl = labelPlaylists.find((playlist) => playlist.spotify_playlist_image_url)?.spotify_playlist_image_url ?? null;
          return (
            <div key={label.label_key} className="sb-card p-4">
              <div className="flex items-center gap-3">
                {imageUrl ? (
                  <Image src={imageUrl} alt={label.display_name} width={44} height={44} className="h-11 w-11 rounded-xl object-cover sb-ring" />
                ) : (
                  <div className="h-11 w-11 rounded-xl bg-white/10 sb-ring" />
                )}
                <div>
                  <div className="font-display text-lg font-semibold">{label.display_name}</div>
                  <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                    {labelPlaylists.length} playlist{labelPlaylists.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <div className="text-[11px] uppercase opacity-60">Tracks</div>
                  <div className="font-mono">{formatInt(trackCount)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase opacity-60">Streams</div>
                  <div className="font-mono">{formatInt(totalStreams)}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase opacity-60">Unenriched</div>
                  <div className="font-mono">{formatInt(unenrichedTracks)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sb-card p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wider opacity-60">Playlist health</div>
        <GlassTable headers={["", "Competitor", "Playlist", "Tracks", "Rows", "Missing totals", "Warnings", "Latest export", ""]}>
          {playlists.map((playlist) => {
            const stat = latestStatByPlaylist.get(playlist.playlist_key);
            const exportRow = latestExportByPlaylist.get(playlist.playlist_key);
            const label = labels.find((row) => row.label_key === playlist.label_key);
            const rowsMatch =
              stat?.track_count != null && exportRow?.rows_count != null
                ? Number(stat.track_count) === Number(exportRow.rows_count)
                : null;
            return (
              <TableRow key={playlist.playlist_key}>
                <TableCell>
                  {playlist.spotify_playlist_image_url ? (
                    <Image src={playlist.spotify_playlist_image_url} alt={playlist.display_name} width={32} height={32} className="h-8 w-8 rounded-lg object-cover sb-ring" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg bg-white/10 sb-ring" />
                  )}
                </TableCell>
                <TableCell>{label?.display_name ?? playlist.label_key}</TableCell>
                <TableCell>
                  <Link href={`/playlists?playlist_key=${encodeURIComponent(playlist.playlist_key)}`} className="sb-link-hover font-medium">
                    {playlist.display_name}
                  </Link>
                </TableCell>
                <TableCell numeric>{stat?.track_count == null ? "—" : formatInt(stat.track_count)}</TableCell>
                <TableCell numeric>
                  <span className={rowsMatch === false ? "text-amber-500" : ""}>
                    {exportRow?.rows_count == null ? "—" : formatInt(exportRow.rows_count)}
                  </span>
                </TableCell>
                <TableCell numeric>{stat?.missing_streams_track_count == null ? "—" : formatInt(stat.missing_streams_track_count)}</TableCell>
                <TableCell numeric>{formatInt(warningCountByPlaylist.get(playlist.playlist_key) ?? 0)}</TableCell>
                <TableCell>{fmtMaybeDate(exportRow?.exported_at)}</TableCell>
                <TableCell>
                  <a href={playlist.sot_dashboard_url} target="_blank" rel="noreferrer" className="sb-link-hover text-xs">
                    SpotOnTrack
                  </a>
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
      </div>
    </div>
  );
}
