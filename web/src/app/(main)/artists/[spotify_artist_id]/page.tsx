import Link from "next/link";
import { User } from "lucide-react";

import { formatInt } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { getArtists } from "@/lib/spotify";

export const revalidate = 86400; // 24h ISR - artist dashboards update daily

type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
};

type DailyStreamsRow = {
  date: string;
  streams_cumulative: number | null;
};

export default async function ArtistPage({
  params,
}: {
  params: any;
}) {
  const { spotify_artist_id } = params as { spotify_artist_id: string };
  const sb = await supabaseServer();

  // Find all tracks by this artist
  const { data: tracks, error: tracksErr } = await sb
    .from("tracks")
    .select("isrc,name,spotify_album_image_url,spotify_artist_names")
    .contains("spotify_artist_ids", [spotify_artist_id])
    .order("last_seen", { ascending: false })
    .limit(500);

  const trackRows = (tracks ?? []) as TrackRow[];
  const isrcs = trackRows.map((t) => t.isrc);

  // Aggregate daily streams across all tracks
  const { data: dailyStreams, error: streamsErr } = isrcs.length
    ? await sb
        .from("track_daily_streams")
        .select("date,isrc,streams_cumulative")
        .in("isrc", isrcs)
        .order("date", { ascending: false })
        .limit(1000)
    : { data: [] };

  // Group by date and sum streams
  const streamsByDate = new Map<string, number>();
  (dailyStreams ?? []).forEach((row: DailyStreamsRow & { isrc: string }) => {
    const existing = streamsByDate.get(row.date) ?? 0;
    streamsByDate.set(row.date, existing + Number(row.streams_cumulative ?? 0));
  });

  const chartData = Array.from(streamsByDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const latestTotal = chartData.length ? chartData[chartData.length - 1].value : 0;
  const prevTotal = chartData.length > 1 ? chartData[chartData.length - 2].value : 0;
  const dailyGrowth = latestTotal - prevTotal;

  // Get artist name from first track (simplified - could enhance with Spotify API lookup)
  const artistName = trackRows[0]?.spotify_artist_names?.[0] ?? "Unknown Artist";

  // Fetch artist image from Spotify API
  const artistDataMap = await getArtists([spotify_artist_id]);
  const artistData = artistDataMap.get(spotify_artist_id);
  const artistImageUrl = artistData?.imageUrl ?? null;

  return (
    <div className="space-y-4">
      <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
        <Link className="underline" href="/tracks">
          Tracks
        </Link>{" "}
        / <span className="font-mono opacity-70">Artist</span>
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          {artistImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={artistImageUrl}
              alt={artistName}
              className="h-16 w-16 rounded-full object-cover sb-ring"
            />
          ) : (
            <div className="h-16 w-16 rounded-full sb-ring bg-white/60 flex items-center justify-center">
              <User className="h-8 w-8 opacity-40" />
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{artistName}</h1>
            <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Spotify Artist ID: <span className="font-mono">{spotify_artist_id}</span>
            </div>
          </div>
        </div>
      </div>

      {(tracksErr || streamsErr) && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {tracksErr?.message ?? streamsErr?.message ?? "unknown"}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="sb-card p-3">
          <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
            Total Streams
          </div>
          <div className="mt-1 text-xl font-semibold">{formatInt(latestTotal)}</div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Across all tracks
          </div>
        </div>

        <div className="sb-card p-3">
          <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
            Daily Growth
          </div>
          <div className="mt-1 text-xl font-semibold">{formatInt(dailyGrowth)}</div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Latest change
          </div>
        </div>

        <div className="sb-card p-3">
          <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
            Track Count
          </div>
          <div className="mt-1 text-xl font-semibold">{formatInt(trackRows.length)}</div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            In catalog
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <div className="sb-card p-3">
          <div className="text-xs font-medium">Streams over time (all tracks combined)</div>
          <div className="mt-2">
            <DailyStreamsChart data={chartData} valueLabel="Total Streams" heightPx={220} isCumulative={true} />
          </div>
        </div>
      )}

      {/* Tracks List */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Tracks ({trackRows.length})</h2>
        <GlassTable headers={["", "Track", "ISRC"]}>
          {trackRows.map((t) => (
            <TableRow key={t.isrc}>
              <TableCell>
                {t.spotify_album_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.spotify_album_image_url}
                    alt="Album cover"
                    className="h-8 w-8 rounded-lg object-cover sb-ring"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                )}
              </TableCell>
              <TableCell>
                <Link
                  href={`/tracks/${t.isrc}`}
                  className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                >
                  {t.name ?? t.isrc}
                </Link>
              </TableCell>
              <TableCell mono className="text-[11px]">
                {t.isrc}
              </TableCell>
            </TableRow>
          ))}
          {!trackRows.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={3}>
                No tracks found for this artist.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    </div>
  );
}
