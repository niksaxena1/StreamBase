// Server-side Supabase reads for the catalog page (`page.tsx`). Callers gate access
// (admin-only) before invoking these with the service-role client.
import type { SupabaseClient } from "@supabase/supabase-js";

import { cachedQuery } from "@/lib/supabase/cache";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { CACHE_TTL_1H, API_LOOKUP_PAGE_SIZE, API_LOOKUP_TRACK_MAX, API_LOOKUP_LIMIT_500 } from "@/lib/constants";
import { logWarn } from "@/lib/logger";
import { isMissingPostgresFunctionError } from "@/lib/supabase/rpcErrors";
import type { RequestAppContext } from "@/lib/requestAppContext.server";

import {
  chunk,
  type ManualOverrideAnnotation,
  type PlaylistMembershipRow,
  type PlaylistMetaRow,
  type TrackOverrideRowWithIsrc,
  type TrackRow,
} from "./catalogPageUtils";

type CatalogServiceClient = RequestAppContext["svc"];

export async function fetchAllTrackSeries(
  sb: SupabaseClient,
  args: { isrc: string; startDate: string; endDate: string; maxRows?: number },
) {
  const pageSize = API_LOOKUP_PAGE_SIZE;
  const out: Array<{ date: string; streams_cumulative: number | null }> = [];
  let from = 0;
  const max = args.maxRows ?? API_LOOKUP_TRACK_MAX;

  while (from < max) {
    const to = from + pageSize - 1;
    const { data } = await sb
      .from("track_daily_streams_effective_public")
      .select("date,streams_cumulative")
      .eq("isrc", args.isrc)
      .gte("date", args.startDate)
      .lte("date", args.endDate)
      .order("date", { ascending: false })
      .range(from, to);

    const rows = (data ?? []) as Array<{ date: string; streams_cumulative: number | null }>;
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

export async function fetchCatalogArtistSeries(
  sb: SupabaseClient,
  args: { artistId: string; startDate: string; endDate: string },
) {
  const fast = await sb.rpc("catalog_artist_series_fast", {
    artist_id: args.artistId,
    start_date: args.startDate,
    end_date: args.endDate,
  });
  if (!fast.error || !isMissingPostgresFunctionError(fast.error)) return fast;
  return await sb.rpc("catalog_artist_series", {
    artist_id: args.artistId,
    start_date: args.startDate,
    end_date: args.endDate,
  });
}

/** Batch-fetch the distro playlist (playlist_type = 'Distro') for every top-track ISRC. */
export async function fetchTopTrackDistroPlaylists(
  svc: CatalogServiceClient,
  args: { artistId: string; latestRunDate: string | null; topIsrcs: Set<string> },
) {
  const { artistId, latestRunDate, topIsrcs } = args;
  const distroByIsrc = new Map<string, { name: string; imageUrl: string | null }>();
  if (latestRunDate && topIsrcs.size > 0) {
    const allTopIsrcs = Array.from(topIsrcs).filter(Boolean);
    const { data: distroMemRows } = await cachedQuery(
      async () =>
        await svc
          .from("playlist_memberships")
          .select("isrc,playlist_key,valid_to")
          .in("isrc", allTopIsrcs)
          .lte("valid_from", latestRunDate),
      `catalog-top-distro-memberships-${artistId}-${latestRunDate}`,
      CACHE_TTL_1H,
    );
    const activeMemRows = ((distroMemRows ?? []) as Array<{ isrc: string; playlist_key: string; valid_to: string | null }>)
      .filter((r) => r.valid_to == null || r.valid_to >= latestRunDate);
    const uniquePlaylistKeys = [...new Set(activeMemRows.map((r) => r.playlist_key))];
    if (uniquePlaylistKeys.length) {
      const { data: distroPlaylistRows } = await cachedQuery(
        async () =>
          await svc
            .from("playlists")
            .select("playlist_key,display_name,spotify_playlist_image_url")
            .in("playlist_key", uniquePlaylistKeys)
            .eq("playlist_type", "Distro"),
        `catalog-top-distro-playlists-${artistId}-${latestRunDate}`,
        CACHE_TTL_1H,
      );
      const distroPlaylistMap = new Map(
        ((distroPlaylistRows ?? []) as Array<{ playlist_key: string; display_name: string | null; spotify_playlist_image_url: string | null }>)
          .map((p) => [p.playlist_key, { name: p.display_name ?? p.playlist_key, imageUrl: p.spotify_playlist_image_url ?? null }]),
      );
      for (const r of activeMemRows) {
        const info = distroPlaylistMap.get(r.playlist_key);
        if (info && !distroByIsrc.has(r.isrc)) distroByIsrc.set(r.isrc, info);
      }
    }
  }
  return distroByIsrc;
}

/**
 * Artist-wide override annotations for the top charts.
 * Overrides are stored per-track per-run-date; annotate the artist charts for any track override.
 */
export async function fetchArtistOverrideAnnotations(
  svc: CatalogServiceClient,
  args: {
    artistId: string;
    artistTracks: TrackRow[];
    isrcs: string[];
    startRunDate: string | null;
    latestRunDate: string | null;
    hideStaleAnnotations: boolean;
    overrideBuster: string;
  },
): Promise<ManualOverrideAnnotation[]> {
  const { artistId, artistTracks, isrcs, startRunDate, latestRunDate, hideStaleAnnotations, overrideBuster } = args;
  if (!latestRunDate || !startRunDate) return [];
  if (!isrcs.length) return [];

  const metaByIsrc = new Map<string, TrackRow>();
  for (const t of artistTracks) {
    if (!t?.isrc) continue;
    metaByIsrc.set(t.isrc, t);
  }

  const chunks = chunk(isrcs, 200);

  // Fetch all chunks in parallel — each is independently cached.
  const chunkResults = await Promise.all(
    chunks.map((isrcChunk, i) =>
      cachedQuery(
        async () => {
          let q = svc
            .from("track_daily_stream_overrides")
            .select("date,isrc,note")
            .in("isrc", isrcChunk)
            .gte("date", startRunDate)
            .lte("date", latestRunDate);
          if (hideStaleAnnotations) q = q.not("note", "like", "stale-fix:%");
          return await q.order("date", { ascending: false }).limit(API_LOOKUP_LIMIT_500);
        },
        `catalog-artist-overrides-${artistId}-${startRunDate}-${latestRunDate}-c${i}-ov${overrideBuster}-stale${hideStaleAnnotations ? "1" : "0"}`,
        CACHE_TTL_1H,
      ),
    ),
  );

  const rowsAll: TrackOverrideRowWithIsrc[] = chunkResults.flatMap(
    ({ data: rowsRaw }) => (rowsRaw ?? []) as TrackOverrideRowWithIsrc[],
  );

  const deduped: TrackOverrideRowWithIsrc[] = [];
  const seen = new Set<string>();
  for (const r of rowsAll) {
    const d = (r?.date ?? "").trim();
    const isrc = (r?.isrc ?? "").trim();
    if (!d || !isrc) continue;
    const key = `${d}||${isrc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ date: d, isrc, note: r.note ?? null });
  }

  deduped.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    return a.isrc.localeCompare(b.isrc);
  });

  return deduped.slice(0, 500).map((o) => {
    const t = metaByIsrc.get(o.isrc) ?? null;
    const artist = t?.spotify_artist_names?.[0] ?? null;
    const trackName = t?.name ?? null;
    const title =
      artist && trackName
        ? `${artist} - ${trackName}`
        : trackName
          ? trackName
          : artist
            ? artist
            : o.isrc;

    return {
      date: dataDateFromRunDate(o.date),
      title,
      imageUrl: t?.spotify_album_image_url ?? null,
      note: (o.note ?? "").trim() || `Manual override (ISRC: ${o.isrc})`,
    };
  });
}

/** Selected track playlist memberships (active as-of latestRunDate). */
export async function fetchSelectedTrackPlaylistMemberships(
  svc: CatalogServiceClient,
  args: { isrc: string | null; latestRunDate: string | null },
) {
  const { isrc, latestRunDate } = args;
  if (!isrc || !latestRunDate) return [];

  const { data: membershipRows, error: membershipErr } = await cachedQuery(
    async () =>
      await svc
        .from("playlist_memberships")
        .select("playlist_key,valid_from,valid_to")
        .eq("isrc", isrc)
        .lte("valid_from", latestRunDate)
        .order("playlist_key", { ascending: true })
        .order("valid_from", { ascending: false })
        .limit(API_LOOKUP_TRACK_MAX),
    `catalog-track-playlist-memberships-v1-${isrc}-${latestRunDate}`,
    CACHE_TTL_1H,
  );

  if (membershipErr) {
    logWarn("Error fetching track playlist memberships", membershipErr);
    return [];
  }

  const latestByPlaylist = new Map<string, PlaylistMembershipRow>();
  for (const r of (membershipRows ?? []) as PlaylistMembershipRow[]) {
    const key = String(r?.playlist_key ?? "").trim();
    if (!key) continue;
    if (!latestByPlaylist.has(key)) latestByPlaylist.set(key, r);
  }

  const latestRows = Array.from(latestByPlaylist.values());
  const playlistKeys = latestRows
    .map((r) => String(r.playlist_key ?? "").trim())
    .filter(Boolean);
  if (!playlistKeys.length) return [];

  // Fetch playlist metadata. Playlist config changes rarely (display_name, type, image);
  // cache for 1h so repeated track selections don't re-query on every page load.
  // Also provide a fallback if `playlist_type`/`display_order` columns don't exist yet.
  let playlistMetaRows: unknown[] = [];
  try {
    const { data: cachedMeta } = await cachedQuery(
      async () => {
        const res = await svc
          .from("playlists")
          .select(
            "playlist_key,display_name,is_catalog,playlist_type,display_order,spotify_playlist_id,spotify_playlist_image_url",
          )
          .in("playlist_key", playlistKeys);

        if (
          res.error &&
          (String(res.error.message ?? "").includes("playlist_type") ||
            String(res.error.message ?? "").includes("display_order"))
        ) {
          return svc
            .from("playlists")
            .select("playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url")
            .in("playlist_key", playlistKeys);
        }

        return res;
      },
      `catalog-track-playlist-meta-${[...playlistKeys].sort().join(",")}`,
      CACHE_TTL_1H,
    );
    playlistMetaRows = (cachedMeta ?? []) as unknown[];
  } catch (e) {
    logWarn("Error fetching playlist metadata", e);
  }

  const metaByKey = new Map<string, PlaylistMetaRow>();
  for (const r of (playlistMetaRows ?? []) as PlaylistMetaRow[]) {
    const key = String(r?.playlist_key ?? "").trim();
    if (!key) continue;
    metaByKey.set(key, r);
  }

  const out = latestRows.map((r) => {
    const key = String(r.playlist_key ?? "").trim();
    const meta = metaByKey.get(key) ?? null;
    const playlistTypeRaw = (meta?.playlist_type ?? "").trim();
    const playlistType =
      playlistTypeRaw || (meta?.is_catalog ? "Catalog" : "Standard");
    return {
      playlistKey: key,
      playlistName: (meta?.display_name ?? "").trim() || key,
      playlistType,
      displayOrder: typeof meta?.display_order === "number" ? meta.display_order : null,
      addedRunDate: String(r.valid_from).slice(0, 10),
      removedRunDate: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
      spotifyPlaylistId: meta?.spotify_playlist_id ?? null,
      spotifyPlaylistImageUrl: meta?.spotify_playlist_image_url ?? null,
      isCatalog: Boolean(meta?.is_catalog),
    };
  });

  out.sort((a, b) => {
    // Match /playlists/config ordering:
    // 1) display_order ASC (NULLS LAST)
    // 2) is_catalog DESC
    // 3) display_name ASC
    const ao = a.displayOrder;
    const bo = b.displayOrder;
    const aHas = ao != null && Number.isFinite(ao);
    const bHas = bo != null && Number.isFinite(bo);
    if (aHas && bHas && ao !== bo) return ao - bo;
    if (aHas !== bHas) return aHas ? -1 : 1;

    const ac = a.isCatalog ? 1 : 0;
    const bc = b.isCatalog ? 1 : 0;
    if (ac !== bc) return bc - ac;

    const n = a.playlistName.localeCompare(b.playlistName);
    if (n !== 0) return n;
    return a.playlistKey.localeCompare(b.playlistKey);
  });
  return out;
}
