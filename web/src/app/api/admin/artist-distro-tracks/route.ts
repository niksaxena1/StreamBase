import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** First two distinct dates, newest first (matches catalog/config stream logic). */
async function getLatestTwoStreamDates(
  svc: ReturnType<typeof supabaseService>,
): Promise<{ latest: string | null; previous: string | null }> {
  const dates: string[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const pageSize = 1000;
  const maxScan = 25000;

  while (dates.length < 2 && offset < maxScan) {
    const { data, error } = await svc
      .from("track_daily_streams_effective_public")
      .select("date")
      .order("date", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("artist-distro-tracks: stream dates", error);
      break;
    }
    const rows = data ?? [];
    if (!rows.length) break;

    for (const r of rows) {
      const d = r.date as string;
      if (!seen.has(d)) {
        seen.add(d);
        dates.push(d);
        if (dates.length >= 2) break;
      }
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return { latest: dates[0] ?? null, previous: dates[1] ?? null };
}

const MAX_TRACKS = 5000;
const PAGE = 1000;

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const artistId = (searchParams.get("artist_id") ?? "").trim();
  if (!artistId) {
    return apiJsonErr("artist_id required", 400);
  }

  const svc = supabaseService();
  const todayDate = new Date().toISOString().slice(0, 10);

  const trackRows: Array<{
    isrc: string;
    name: string | null;
    spotify_album_image_url: string | null;
    spotify_artist_names: string[] | null;
    spotify_artist_ids: string[] | null;
    spotify_track_id: string | null;
  }> = [];

  let from = 0;
  while (trackRows.length < MAX_TRACKS) {
    const { data, error } = await svc
      .from("tracks")
      .select(
        "isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids,spotify_track_id",
      )
      .contains("spotify_artist_ids", [artistId])
      .order("last_seen", { ascending: false })
      .order("isrc", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("artist-distro-tracks: tracks", error);
      return apiJsonErr(error.message, 500);
    }
    const rows = data ?? [];
    if (!rows.length) break;
    trackRows.push(...(rows as typeof trackRows));
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const isrcs = trackRows.map((t) => t.isrc);

  const { data: distroPlaylistRows } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .eq("playlist_type", "Distro");

  const distroPlaylists = ((distroPlaylistRows ?? []) as Array<{
    playlist_key: string;
    display_name: string | null;
    spotify_playlist_image_url: string | null;
  }>).map((p) => ({
    key: p.playlist_key,
    name: p.display_name ?? p.playlist_key,
    imageUrl: p.spotify_playlist_image_url ?? null,
  }));

  const distroKeys = distroPlaylists.map((p) => p.key);
  const distroInfoByKey = new Map(distroPlaylists.map((p) => [p.key, p]));

  const isrcDistroMap = new Map<string, DistroPlaylist[]>();

  if (distroKeys.length && isrcs.length) {
    const membershipRows: Array<{ isrc: string; playlist_key: string; valid_to: string | null }> = [];
    for (const isrcChunk of chunk(isrcs, 200)) {
      let mFrom = 0;
      while (true) {
        const { data: page } = await svc
          .from("playlist_memberships")
          .select("isrc,playlist_key,valid_to")
          .in("playlist_key", distroKeys)
          .in("isrc", isrcChunk)
          .or(`valid_to.is.null,valid_to.gte.${todayDate}`)
          .range(mFrom, mFrom + PAGE - 1);
        const rows = (page ?? []) as typeof membershipRows;
        membershipRows.push(...rows);
        if (rows.length < PAGE) break;
        mFrom += PAGE;
      }
    }

    for (const r of membershipRows) {
      const info = distroInfoByKey.get(r.playlist_key);
      if (!info) continue;
      if (!isrcDistroMap.has(r.isrc)) isrcDistroMap.set(r.isrc, []);
      const list = isrcDistroMap.get(r.isrc)!;
      if (!list.some((e) => e.key === info.key)) list.push(info);
    }
  }

  const artistPlaylistMap = new Map<string, DistroPlaylist>();
  for (const t of trackRows) {
    const distros = isrcDistroMap.get(t.isrc) ?? [];
    for (const d of distros) {
      if (!artistPlaylistMap.has(d.key)) artistPlaylistMap.set(d.key, d);
    }
  }
  const playlists = Array.from(artistPlaylistMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const playlistKeySet = new Set(playlists.map((p) => p.key));

  const { latest, previous } = await getLatestTwoStreamDates(svc);

  const latestStreams = new Map<string, number>();
  const previousStreams = new Map<string, number>();

  if (latest && isrcs.length) {
    const dates = previous ? [latest, previous] : [latest];
    for (const isrcChunk of chunk(isrcs, 150)) {
      const { data: streamPage, error: streamErr } = await svc
        .from("track_daily_streams_effective_public")
        .select("date,isrc,streams_cumulative")
        .in("isrc", isrcChunk)
        .in("date", dates);

      if (streamErr) {
        console.error("artist-distro-tracks: streams", streamErr);
        break;
      }
      for (const row of streamPage ?? []) {
        const isrc = row.isrc as string;
        const date = row.date as string;
        const cum = row.streams_cumulative as number | null;
        if (cum === null) continue;
        if (date === latest) latestStreams.set(isrc, cum);
        if (previous && date === previous) previousStreams.set(isrc, cum);
      }
    }
  }

  const nameByArtistId: Record<string, string> = {};
  for (const t of trackRows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      const id = ids[i];
      const name = names[i];
      if (id && name && !nameByArtistId[id]) nameByArtistId[id] = name;
    }
  }

  let artistName = nameByArtistId[artistId];
  if (!artistName) {
    for (const t of trackRows) {
      const ids = t.spotify_artist_ids ?? [];
      const names = t.spotify_artist_names ?? [];
      const idx = ids.indexOf(artistId);
      if (idx >= 0 && names[idx]) {
        artistName = names[idx]!;
        break;
      }
    }
  }
  artistName = artistName ?? artistId;

  const tracks = trackRows
    .map((track) => {
      const distros = isrcDistroMap.get(track.isrc) ?? [];
      const total = latestStreams.get(track.isrc) ?? null;
      const prev = previousStreams.get(track.isrc) ?? null;
      let daily: number | null = null;
      if (total !== null && prev !== null) {
        daily = Math.max(0, total - prev);
      }
      return {
        isrc: track.isrc,
        name: track.name,
        albumImageUrl: track.spotify_album_image_url ?? null,
        artistIds: track.spotify_artist_ids ?? null,
        totalStreams: total,
        dailyStreams: daily,
        distroPlaylists: distros,
        externalUrl: track.spotify_track_id
          ? `https://open.spotify.com/track/${track.spotify_track_id}`
          : null,
      };
    })
    .filter(
      (t) =>
        t.distroPlaylists.some((d) => playlistKeySet.has(d.key)),
    );

  return apiJsonOk({
    artistName,
    playlists,
    tracks,
    nameByArtistId,
  });
}
