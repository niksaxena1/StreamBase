import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const MEMBERSHIP_PAGE = 1000;

/** Comma-separated; wraps segments that contain comma or quote (Excel-friendly). */
function joinArtistsForSpreadsheet(names: string[] | null | undefined): string {
  if (!names?.length) return "";
  return names
    .map((n) => {
      const s = String(n).trim();
      if (s.includes(",") || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    })
    .join(", ");
}

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
      console.error("isrc-batch-details: stream dates", error);
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

const MAX_ISRCS = 4000;

type DistroPlaylistDetail = {
  key: string;
  name: string;
  imageUrl: string | null;
};

type TrackArtistDetail = {
  id: string;
  name: string;
  imageUrl: string | null;
};

type IsrcBatchDetailRow = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_track_id: string | null;
  release_date: string | null;
  totalStreams: number | null;
  dailyStreams: number | null;
  /** Comma-separated credited artists from tracks.spotify_artist_names */
  artistsOnTrack: string;
  /** Comma-separated distro playlist display names (playlist_type = Distro, active membership) */
  distroPlaylists: string;
  /** Distro playlists this ISRC is active in (thumbnails + keys for linking). */
  distroPlaylistDetails: DistroPlaylistDetail[];
  /** Credited artists with Spotify IDs and optional cached images. */
  trackArtists: TrackArtistDetail[];
};

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const raw = (body as { isrcs?: unknown })?.isrcs;
  const isrcsRaw = (
    Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim())
      : []
  ).slice(0, MAX_ISRCS);
  const isrcs = [...new Set(isrcsRaw)];

  if (!isrcs.length) {
    return apiJsonOk({ tracks: [] as IsrcBatchDetailRow[] });
  }

  const svc = supabaseService();
  const wanted = new Set(isrcs);
  const todayDate = new Date().toISOString().slice(0, 10);

  const metaByIsrc = new Map<
    string,
    {
      name: string | null;
      spotify_album_image_url: string | null;
      spotify_track_id: string | null;
      release_date: string | null;
      spotify_artist_names: string[] | null;
      spotify_artist_ids: string[] | null;
    }
  >();

  for (const part of chunk(isrcs, 200)) {
    const { data, error } = await svc
      .from("tracks")
      .select(
        "isrc,name,spotify_album_image_url,spotify_track_id,release_date,spotify_artist_names,spotify_artist_ids",
      )
      .in("isrc", part);

    if (error) {
      console.error("isrc-batch-details: tracks", error);
      return apiJsonErr(error.message, 500);
    }
    for (const r of (data ?? []) as Array<{
      isrc: string;
      name: string | null;
      spotify_album_image_url: string | null;
      spotify_track_id: string | null;
      release_date: string | null;
      spotify_artist_names: string[] | null;
      spotify_artist_ids: string[] | null;
    }>) {
      if (!wanted.has(r.isrc) || metaByIsrc.has(r.isrc)) continue;
      const rd = r.release_date;
      const tid = r.spotify_track_id;
      metaByIsrc.set(r.isrc, {
        name: r.name,
        spotify_album_image_url: r.spotify_album_image_url ?? null,
        spotify_track_id: typeof tid === "string" && tid.trim() ? tid.trim() : null,
        release_date: typeof rd === "string" ? rd : rd != null ? String(rd) : null,
        spotify_artist_names: Array.isArray(r.spotify_artist_names) ? r.spotify_artist_names : null,
        spotify_artist_ids: Array.isArray(r.spotify_artist_ids) ? r.spotify_artist_ids : null,
      });
    }
  }

  const allArtistIds = new Set<string>();
  for (const m of metaByIsrc.values()) {
    for (const raw of m.spotify_artist_ids ?? []) {
      const id = String(raw ?? "").trim();
      if (id) allArtistIds.add(id);
    }
  }

  const artistImageById = new Map<string, string | null>();
  if (allArtistIds.size > 0) {
    for (const part of chunk([...allArtistIds], 200)) {
      const { data: imgRows, error: imgErr } = await svc
        .from("spotify_artist_images")
        .select("artist_id,image_url")
        .in("artist_id", part);
      if (imgErr) {
        console.error("isrc-batch-details: artist images", imgErr);
        break;
      }
      for (const row of (imgRows ?? []) as Array<{ artist_id: string; image_url: string | null }>) {
        artistImageById.set(String(row.artist_id), row.image_url ?? null);
      }
    }
  }

  const distroDetailsByIsrc = new Map<string, DistroPlaylistDetail[]>();

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
    name: (p.display_name ?? p.playlist_key).trim(),
    imageUrl: p.spotify_playlist_image_url ?? null,
  }));

  const distroKeys = distroPlaylists.map((p) => p.key);
  const distroMetaByKey = new Map(distroPlaylists.map((p) => [p.key, p]));

  if (distroKeys.length && isrcs.length) {
    const membershipRows: Array<{ isrc: string; playlist_key: string }> = [];
    for (const isrcChunk of chunk(isrcs, 200)) {
      let mFrom = 0;
      while (true) {
        const { data: page, error: memErr } = await svc
          .from("playlist_memberships")
          .select("isrc,playlist_key,valid_to")
          .in("playlist_key", distroKeys)
          .in("isrc", isrcChunk)
          .or(`valid_to.is.null,valid_to.gte.${todayDate}`)
          .range(mFrom, mFrom + MEMBERSHIP_PAGE - 1);

        if (memErr) {
          console.error("isrc-batch-details: distro memberships", memErr);
          break;
        }
        const rows = (page ?? []) as Array<{ isrc: string; playlist_key: string }>;
        membershipRows.push(...rows);
        if (rows.length < MEMBERSHIP_PAGE) break;
        mFrom += MEMBERSHIP_PAGE;
      }
    }

    for (const r of membershipRows) {
      const pl = distroMetaByKey.get(r.playlist_key);
      if (!pl) continue;
      if (!distroDetailsByIsrc.has(r.isrc)) distroDetailsByIsrc.set(r.isrc, []);
      const list = distroDetailsByIsrc.get(r.isrc)!;
      if (!list.some((x) => x.key === pl.key)) {
        list.push({ key: pl.key, name: pl.name, imageUrl: pl.imageUrl });
      }
    }

    for (const [, list] of distroDetailsByIsrc) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

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
        console.error("isrc-batch-details: streams", streamErr);
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

  const tracks: IsrcBatchDetailRow[] = isrcs.map((isrc) => {
    const meta = metaByIsrc.get(isrc);
    const total = latestStreams.get(isrc) ?? null;
    const prev = previousStreams.get(isrc) ?? null;
    let daily: number | null = null;
    if (total !== null && prev !== null) {
      daily = Math.max(0, total - prev);
    }
    const distroDetailList = distroDetailsByIsrc.get(isrc) ?? [];
    const distroNameList = distroDetailList.map((d) => d.name);

    const ids = meta?.spotify_artist_ids ?? [];
    const names = meta?.spotify_artist_names ?? [];
    const nArt = Math.max(ids.length, names.length);
    const trackArtists: TrackArtistDetail[] = [];
    const seenArtist = new Set<string>();
    for (let i = 0; i < nArt; i++) {
      const id = String(ids[i] ?? "").trim();
      if (!id || seenArtist.has(id)) continue;
      seenArtist.add(id);
      const nm = String(names[i] ?? "").trim() || id;
      trackArtists.push({
        id,
        name: nm,
        imageUrl: artistImageById.get(id) ?? null,
      });
    }

    return {
      isrc,
      name: meta?.name ?? null,
      spotify_album_image_url: meta?.spotify_album_image_url ?? null,
      spotify_track_id: meta?.spotify_track_id ?? null,
      release_date: meta?.release_date ?? null,
      totalStreams: total,
      dailyStreams: daily,
      artistsOnTrack: joinArtistsForSpreadsheet(meta?.spotify_artist_names ?? null),
      distroPlaylists: joinArtistsForSpreadsheet(distroNameList),
      distroPlaylistDetails: distroDetailList,
      trackArtists,
    };
  });

  return apiJsonOk({ tracks });
}
