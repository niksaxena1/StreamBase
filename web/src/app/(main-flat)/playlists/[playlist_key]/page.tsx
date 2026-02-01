import Link from "next/link";
import { ListMusic } from "lucide-react";

import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { DatePicker } from "@/components/ui/DatePicker";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { dataDateFromRunDate, addDaysISO, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { SectionHeader } from "@/components/ui/SectionHeader";

export const revalidate = 86400; // 24h ISR - playlist snapshots update daily

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
};

type TrackOnDate = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_artist_ids: string[] | null;
  valid_from: string;
  valid_to: string | null;
};

export async function generateStaticParams() {
  // Pre-build detail pages for all configured playlists.
  const svc = supabaseService();
  const { data } = await svc
    .from("playlists")
    .select("playlist_key")
    .order("playlist_key", { ascending: true });

  return (data ?? []).map((row: { playlist_key: string }) => ({
    playlist_key: row.playlist_key,
  }));
}

export default async function PlaylistDetailPage({
  params,
  searchParams,
}: {
  params: { playlist_key: string };
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { playlist_key } = params;
  const sp = (await searchParams) ?? {};
  const dateParam = typeof sp.date === "string" ? sp.date : undefined;
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");


  const { data: playlist, error: playlistErr } = await sb
    .from("playlists")
    .select(
      "playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url",
    )
    .eq("playlist_key", playlist_key)
    .maybeSingle();

  // Best-effort: if spotify_playlist_id is set, keep thumbnail cached.
  const playlistRow = (playlist ?? null) as PlaylistRow | null;
  let spotifyImg: string | null = playlistRow?.spotify_playlist_image_url ?? null;
  try {
    const id = playlistRow?.spotify_playlist_id ?? null;
    if (id && !spotifyImg) {
      const meta = await getPlaylist(id);
      const svc = supabaseService();
      await svc
        .from("playlists")
        .update({
          spotify_playlist_name: meta.name,
          spotify_playlist_image_url: meta.imageUrl,
          spotify_last_fetched_at: new Date().toISOString(),
        })
        .eq("playlist_key", playlist_key);
      spotifyImg = meta.imageUrl;
    }
  } catch {
    // ignore
  }

  const { data: stats, error: statsErr } = await sb
    .from("playlist_daily_stats")
    .select(
      "date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net,missing_streams_track_count",
    )
    .eq("playlist_key", playlist_key)
    .order("date", { ascending: false })
    .limit(30);

  // Determine selected date (from query param or latest stats date)
  const latestDate = stats?.[0]?.date ?? null;
  // UI shows "data date" (run_date - lag). Map back to stored run_date for querying.
  const selectedDataDate = dateParam ?? (latestDate ? dataDateFromRunDate(latestDate) : null);
  const selectedDate =
    selectedDataDate
      ? addDaysISO(selectedDataDate, SOT_DATA_LAG_DAYS)
      : latestDate ?? new Date().toISOString().split("T")[0];

  // Query tracks active on selected date
  const { data: memberships, error: tracksErr } = await sb
    .from("playlist_memberships")
    .select("isrc,valid_from,valid_to")
    .eq("playlist_key", playlist_key)
    .lte("valid_from", selectedDate)
    .or(`valid_to.is.null,valid_to.gte.${selectedDate}`)
    .order("isrc", { ascending: true })
    .limit(1000);

  const isrcs = (memberships ?? []).map((m) => m.isrc);
  const { data: trackData } = isrcs.length
    ? await sb
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
        .in("isrc", isrcs)
    : { data: [] };

  const trackMap = new Map((trackData ?? []).map((t) => [t.isrc, t]));

  const tracks: TrackOnDate[] = (memberships ?? []).map((m) => {
    const t = trackMap.get(m.isrc);
    return {
      isrc: m.isrc,
      name: t?.name ?? null,
      spotify_album_image_url: t?.spotify_album_image_url ?? null,
      spotify_artist_names: t?.spotify_artist_names ?? null,
      spotify_artist_ids: t?.spotify_artist_ids ?? null,
      valid_from: m.valid_from,
      valid_to: m.valid_to,
    };
  });

  // Get date range for picker (first stats date to today)
  const firstRunDate = stats?.[stats.length - 1]?.date ?? selectedDate;
  const firstDate = dataDateFromRunDate(firstRunDate);
  const today = new Date().toISOString().split("T")[0];
  const todayDataDate = dataDateFromRunDate(today);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--sb-muted)" }}>
            <Link className="hover:underline" href="/playlists">
              Playlists
            </Link>
            <span>/</span>
            <span className="font-mono opacity-70">{playlist_key}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            {spotifyImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={spotifyImg}
                alt="Playlist cover"
                className="h-12 w-12 rounded-xl object-cover sb-ring"
              />
            ) : (
              <div className="h-12 w-12 rounded-xl sb-ring bg-white/60" />
            )}
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              <Link
                href={`/playlists/${playlist_key}`}
                className="transition-colors hover:text-lime-600 dark:hover:text-lime-400"
              >
                {playlistRow?.display_name ?? playlist_key}
              </Link>
            </h1>
          </div>
          <div className="mt-2 flex items-center gap-3">
            {playlistRow?.is_catalog ? (
              <span className="inline-flex items-center rounded-full bg-lime-400/20 px-2.5 py-0.5 text-xs font-medium text-lime-800 dark:text-lime-300">
                Catalog
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                Standard
              </span>
            )}
          </div>
        </div>
        <div className="rounded-full bg-white/50 p-2 backdrop-blur-md dark:bg-white/5">
          <ListMusic className="h-5 w-5 opacity-70" />
        </div>
      </div>


      {isAdmin && !playlistRow?.spotify_playlist_id ? (
        <Alert
          variant="info"
          title="Enable Spotify playlist thumbnail"
        >
          To enable the Spotify playlist thumbnail, set a Spotify playlist URL/URI/ID in{" "}
          <Link className="underline" href="/playlists/config/settings">Playlist Settings</Link>.
        </Alert>
      ) : null}

      {(playlistErr || statsErr || tracksErr) && (
        <Alert variant="error" title="Query error">
          {playlistErr?.message ?? statsErr?.message ?? tracksErr?.message ?? "unknown error"}
        </Alert>
      )}

      {/* Tracks on Date Section */}
      <div className="space-y-2">
        <SectionHeader
          title="Tracks on Date"
          actions={
            <DatePicker
              value={selectedDataDate ?? dataDateFromRunDate(selectedDate)}
              min={firstDate}
              max={todayDataDate}
              label="View date"
              path={`/playlists/${playlist_key}`}
            />
          }
        />

        <GlassTable headers={["", "Track", "ISRC", "Added", "Removed"]}>
          {tracks.map((t) => (
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
                {t.spotify_artist_names?.length ? (
                  <div className="text-xs opacity-60 mt-0.5">
                    <ArtistLinks
                      artistNames={t.spotify_artist_names}
                      artistIds={t.spotify_artist_ids ?? undefined}
                    />
                  </div>
                ) : null}
              </TableCell>
              <TableCell mono className="text-[11px] opacity-40" style={{ color: "var(--sb-muted)" }}>
                {t.isrc}
              </TableCell>
              <TableCell mono className="text-[11px]">
                {formatDateISO(dataDateFromRunDate(t.valid_from))}
              </TableCell>
              <TableCell mono className="text-[11px]">
                {t.valid_to ? formatDateISO(dataDateFromRunDate(t.valid_to)) : "—"}
              </TableCell>
            </TableRow>
          ))}
          {!tracks.length && <EmptyState colSpan={5} message="No tracks found for this date." />}
        </GlassTable>
      </div>

      <div className="space-y-2">
        <SectionHeader
          title="History (30d)"
          actions={
            <span className="text-xs opacity-50">
              Missing streams = tracks not present in catalog snapshot today
            </span>
          }
        />
        
        <GlassTable
          headers={[
            { label: "Date" },
            { label: "Tracks", align: "right" },
            { label: "Total Streams", align: "right" },
            { label: "Daily", align: "right" },
            { label: "Est. Rev", align: "right" },
            { label: "Missing", align: "right" },
          ]}
        >
          {(stats ?? []).map((r) => (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(r.date))}</TableCell>
              <TableCell numeric>{formatInt(r.track_count)}</TableCell>
              <TableCell numeric>{formatInt(r.total_streams_cumulative)}</TableCell>
              <TableCell numeric className="text-lime-700 dark:text-lime-400 font-medium">
                +{formatInt(r.daily_streams_net)}
              </TableCell>
              <TableCell numeric>{formatUsd(r.est_revenue_total)}</TableCell>
              <TableCell numeric>
                {r.missing_streams_track_count ? (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    {formatInt(r.missing_streams_track_count)}
                  </span>
                ) : (
                  null
                )}
              </TableCell>
            </TableRow>
          ))}
          {!stats?.length && <EmptyState colSpan={6} message="No stats yet for this playlist." />}
        </GlassTable>
      </div>
    </div>
  );
}
