import Link from "next/link";

import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ playlist_key: string }>;
}) {
  const { playlist_key } = await params;
  const sb = supabaseAdmin();

  const { data: playlist, error: playlistErr } = await sb
    .from("playlists")
    .select("playlist_key,display_name,is_catalog")
    .eq("playlist_key", playlist_key)
    .maybeSingle();

  const { data: stats, error: statsErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,daily_streams_lfl,est_revenue_total,est_revenue_daily_net,est_revenue_daily_lfl,missing_streams_track_count",
    )
    .eq("playlist_key", playlist_key)
    .order("date", { ascending: false })
    .limit(30);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs text-zinc-500">
            <Link className="underline" href="/playlists">
              Playlists
            </Link>{" "}
            / <span className="font-mono">{playlist_key}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {playlist?.display_name ?? playlist_key}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Catalog playlist: <b>{playlist?.is_catalog ? "Yes" : "No"}</b>
          </p>
        </div>
      </div>

      {(playlistErr || statsErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error:{" "}
          {playlistErr?.message ?? statsErr?.message ?? "unknown error"}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="text-sm font-medium">Last 30 days</div>
          <div className="text-xs text-zinc-500">
            Missing streams = tracks not present in catalog snapshot today
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Tracks</th>
                <th className="px-4 py-2">Total streams</th>
                <th className="px-4 py-2">Daily (net)</th>
                <th className="px-4 py-2">Daily (LFL)</th>
                <th className="px-4 py-2">Est. rev (total)</th>
                <th className="px-4 py-2">Missing</th>
              </tr>
            </thead>
            <tbody>
              {(stats ?? []).map((r) => (
                <tr
                  key={r.date}
                  className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {formatDateISO(r.date)}
                  </td>
                  <td className="px-4 py-2">{formatInt(r.track_count)}</td>
                  <td className="px-4 py-2">
                    {formatInt(r.total_streams_cumulative)}
                  </td>
                  <td className="px-4 py-2">{formatInt(r.daily_streams_net)}</td>
                  <td className="px-4 py-2">{formatInt(r.daily_streams_lfl)}</td>
                  <td className="px-4 py-2">{formatUsd(r.est_revenue_total)}</td>
                  <td className="px-4 py-2">
                    {formatInt(r.missing_streams_track_count)}
                  </td>
                </tr>
              ))}
              {!stats?.length && (
                <tr>
                  <td className="px-4 py-6 text-sm text-zinc-500" colSpan={7}>
                    No stats yet for this playlist.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

