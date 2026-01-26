import Link from "next/link";
import { ListMusic } from "lucide-react";

import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { DatePicker } from "@/components/ui/DatePicker";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

export const dynamic = "force-dynamic";

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

export default async function PlaylistDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ playlist_key: string }>;
  searchParams?: Promise<{ date?: string }>;
}) {
  const { playlist_key } = await params;
  const sp = (await searchParams) ?? {};
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
  const selectedDate = sp.date ?? latestDate ?? new Date().toISOString().split("T")[0];

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
  const firstDate = stats?.[stats.length - 1]?.date ?? selectedDate;
  const today = new Date().toISOString().split("T")[0];

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
        <div className="rounded-2xl border border-blue-300 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-200">
          To enable the Spotify playlist thumbnail, set a Spotify playlist URL/URI/ID in{" "}
          <Link className="underline" href="/playlists/config/settings">Playlist Settings</Link>.
        </div>
      ) : null}

      {(playlistErr || statsErr || tracksErr) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error:{" "}
          {playlistErr?.message ?? statsErr?.message ?? tracksErr?.message ?? "unknown error"}
        </div>
      )}

      {/* Tracks on Date Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold">Tracks on Date</h2>
          <DatePicker
            value={selectedDate}
            min={firstDate}
            max={today}
            label="View date"
            path={`/playlists/${playlist_key}`}
          />
        </div>

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
              <TableCell mono className="text-[11px]">
                {t.isrc}
              </TableCell>
              <TableCell mono className="text-[11px]">
                {formatDateISO(t.valid_from)}
              </TableCell>
              <TableCell mono className="text-[11px]">
                {t.valid_to ? formatDateISO(t.valid_to) : "—"}
              </TableCell>
            </TableRow>
          ))}
          {!tracks.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={5}>
                No tracks found for this date.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold">History (30d)</h2>
          <span className="text-xs opacity-50">
            Missing streams = tracks not present in catalog snapshot today
          </span>
        </div>
        
        <GlassTable headers={["Date", "Tracks", "Total Streams", "Daily", "Est. Rev", "Missing"]}>
          {(stats ?? []).map((r) => (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(r.date)}</TableCell>
              <TableCell>{formatInt(r.track_count)}</TableCell>
              <TableCell>{formatInt(r.total_streams_cumulative)}</TableCell>
              <TableCell className="text-lime-700 dark:text-lime-400 font-medium">
                +{formatInt(r.daily_streams_net)}
              </TableCell>
              <TableCell>{formatUsd(r.est_revenue_total)}</TableCell>
              <TableCell>
                {r.missing_streams_track_count ? (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    {formatInt(r.missing_streams_track_count)}
                  </span>
                ) : (
                  <span className="opacity-30">-</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!stats?.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={6}>
                No stats yet for this playlist.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    </div>
  );
}
