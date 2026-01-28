import Link from "next/link";
import { List, ExternalLink } from "lucide-react";
import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";
import { cachedQuery } from "@/lib/supabase/cache";
import { formatDateISO, formatInt } from "@/lib/format";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { PlaylistDashboardControls } from "@/components/dashboard/PlaylistDashboardControls";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";
import { PlaylistPageClient } from "./PlaylistPageClient";
import { PlaylistHeaderWithSelector } from "./PlaylistHeaderWithSelector";
import { PlaylistMetricProvider } from "./PlaylistMetricContext";

export const dynamic = "force-dynamic";

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
};

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
};

type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_artist_ids: string[] | null;
};

type MembershipRow = {
  isrc: string;
  valid_from: string;
  valid_to: string | null;
};

type TrackStreamsRow = { isrc: string; streams_cumulative: number | null };

function clampRangeDays(x: unknown) {
  const n = Number(x ?? "90") || 90;
  return Math.max(7, Math.min(365, n));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchMemberships(sb: Awaited<ReturnType<typeof supabaseServer>>, args: {
  playlistKey: string;
  removed: boolean;
  maxRows: number;
}): Promise<MembershipRow[]> {
  // Handle all_catalog as a combined playlist of releases and ext
  if (args.playlistKey === "all_catalog") {
    // Fetch all memberships (both current and removed) from both playlists to properly combine
    const [releasesCurrent, releasesRemoved, extCurrent, extRemoved] = await Promise.all([
      fetchMemberships(sb, { playlistKey: "releases", removed: false, maxRows: 10000 }),
      fetchMemberships(sb, { playlistKey: "releases", removed: true, maxRows: 10000 }),
      fetchMemberships(sb, { playlistKey: "ext", removed: false, maxRows: 10000 }),
      fetchMemberships(sb, { playlistKey: "ext", removed: true, maxRows: 10000 }),
    ]);

    // Combine all memberships: for each ISRC, take the earliest valid_from
    // For valid_to: null if either playlist has null (track is current), otherwise latest date
    const combinedMap = new Map<string, MembershipRow>();

    for (const m of [...releasesCurrent, ...releasesRemoved, ...extCurrent, ...extRemoved]) {
      const existing = combinedMap.get(m.isrc);
      if (!existing) {
        combinedMap.set(m.isrc, { ...m });
      } else {
        // Use earliest valid_from
        if (m.valid_from < existing.valid_from) {
          existing.valid_from = m.valid_from;
        }
        // If either playlist has null (current), the combined should be null
        // Otherwise, use the latest valid_to date
        if (m.valid_to === null || existing.valid_to === null) {
          existing.valid_to = null;
        } else if (m.valid_to > existing.valid_to) {
          existing.valid_to = m.valid_to;
        }
      }
    }

    // Filter based on removed flag
    let combined = Array.from(combinedMap.values());
    if (args.removed) {
      combined = combined.filter((m) => m.valid_to !== null);
    } else {
      combined = combined.filter((m) => m.valid_to === null);
    }
    
    // Sort appropriately
    if (args.removed) {
      combined.sort((a, b) => {
        if (a.valid_to === null || b.valid_to === null) return 0;
        return b.valid_to.localeCompare(a.valid_to);
      });
    } else {
      combined.sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    }

    return combined.slice(0, args.maxRows);
  }

  // Regular playlist query
  const pageSize = 1000;
  const out: MembershipRow[] = [];
  let from = 0;

  while (from < args.maxRows) {
    const to = from + pageSize - 1;
    const q = sb
      .from("playlist_memberships")
      .select("isrc,valid_from,valid_to")
      .eq("playlist_key", args.playlistKey);

    const { data } = args.removed
      ? await q
          .not("valid_to", "is", null)
          .order("valid_to", { ascending: false })
          .range(from, to)
      : await q
          .is("valid_to", null)
          .order("valid_from", { ascending: false })
          .range(from, to);

    const rows = (data ?? []) as MembershipRow[];
    if (!rows.length) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}


export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams?: Promise<{ playlist_key?: string; range?: string; view?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const playlistKey = (sp.playlist_key ?? "").trim();
  const rangeDays = clampRangeDays(sp.range);

  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");

  // Backwards-compat: old query-driven list view
  if ((sp.view ?? "").trim().toLowerCase() === "list") {
    redirect("/playlists/config");
  }

  // Default view: dashboard (if missing playlist_key, auto-open remembered/default)
  if (!playlistKey) {
    return (
      <RememberParamRedirect
        param="playlist_key"
        storageKey="sb:last_playlist_key"
        defaultValue="all_catalog"
        loadingTitle="Opening your last playlist…"
        loadingSubtitle="If this is your first time, we’ll start with All Catalog."
      />
    );
  }

  // Dashboard view - show analytics for selected playlist (cached for 1 hour)
  const [
    { data: playlists },
    { data: latest },
    { data: prev },
    { data: history },
  ] = await Promise.all([
    cachedQuery(
      async () =>
        await sb
          .from("playlists")
          .select("playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url")
          .order("is_catalog", { ascending: false })
          .order("display_name", { ascending: true }),
      "playlists-list",
      3600,
    ),
    cachedQuery(
      async () =>
        await sb
          .from("playlist_daily_stats")
          .select("date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
          .eq("playlist_key", playlistKey)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      `playlist-latest-${playlistKey}`,
      3600,
    ),
    cachedQuery(
      async () =>
        await sb
          .from("playlist_daily_stats")
          .select("date")
          .eq("playlist_key", playlistKey)
          .order("date", { ascending: false })
          .range(1, 1)
          .maybeSingle(),
      `playlist-prev-${playlistKey}`,
      3600,
    ),
    cachedQuery(
      async () =>
        await sb
          .from("playlist_daily_stats")
          .select("date,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
          .eq("playlist_key", playlistKey)
          .order("date", { ascending: false })
          .limit(rangeDays),
      `playlist-history-${playlistKey}-${rangeDays}`,
      3600,
    ),
  ]);

  const playlistOptions = (playlists ?? []) as PlaylistRow[];
  const currentPlaylist = playlistOptions.find((p) => p.playlist_key === playlistKey);
  const title = currentPlaylist?.display_name ?? playlistKey;
  const playlistImageUrl = currentPlaylist?.spotify_playlist_image_url ?? null;
  const spotifyPlaylistId = currentPlaylist?.spotify_playlist_id ?? null;
  const spotifyUrl = spotifyPlaylistId
    ? `https://open.spotify.com/playlist/${spotifyPlaylistId}`
    : null;

  const latestDate = (latest as PlaylistDailyStatsRow | null)?.date ?? null;
  const prevDate = (prev as { date: string } | null)?.date ?? null;

  const hist = (history ?? []) as PlaylistDailyStatsRow[];

  // Memberships (current + removed)
  const [current, removed] = await Promise.all([
    fetchMemberships(sb, { playlistKey, removed: false, maxRows: 5000 }),
    fetchMemberships(sb, { playlistKey, removed: true, maxRows: 500 }),
  ]);

  const currentIsrcs = current.map((m) => m.isrc);
  const removedIsrcs = removed.map((m) => m.isrc);

  // Enrich memberships with track meta + last-day streams (best-effort)
  const metaByIsrc = new Map<string, TrackRow>();
  const todayByIsrc = new Map<string, number>();
  const prevByIsrc = new Map<string, number>();

  const chunks = chunk(currentIsrcs, 200);
  await Promise.all(
    chunks.map(async (isrcChunk) => {
      const [metaRes, todayRes, prevRes] = await Promise.all([
        sb
          .from("tracks")
          .select("isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
          .in("isrc", isrcChunk),
        latestDate
          ? sb
              .from("track_daily_streams")
              .select("isrc,streams_cumulative")
              .eq("date", latestDate)
              .in("isrc", isrcChunk)
          : Promise.resolve({ data: [] as TrackStreamsRow[] }),
        prevDate
          ? sb
              .from("track_daily_streams")
              .select("isrc,streams_cumulative")
              .eq("date", prevDate)
              .in("isrc", isrcChunk)
          : Promise.resolve({ data: [] as TrackStreamsRow[] }),
      ]);

      for (const t of (metaRes.data ?? []) as TrackRow[]) metaByIsrc.set(t.isrc, t);
      for (const r of (todayRes.data ?? []) as TrackStreamsRow[]) {
        todayByIsrc.set(r.isrc, Number(r.streams_cumulative ?? 0));
      }
      for (const r of (prevRes.data ?? []) as TrackStreamsRow[]) {
        prevByIsrc.set(r.isrc, Number(r.streams_cumulative ?? 0));
      }
    }),
  );

  const currentRows = current
    .map((m) => {
      const meta = metaByIsrc.get(m.isrc);
      const today = todayByIsrc.get(m.isrc) ?? null;
      const prevv = prevByIsrc.get(m.isrc) ?? null;
      const daily =
        today !== null && prevv !== null ? Math.max(0, today - prevv) : null;
      return {
        isrc: m.isrc,
        name: meta?.name ?? null,
        img: meta?.spotify_album_image_url ?? null,
        artists: meta?.spotify_artist_names ?? null,
        artistIds: meta?.spotify_artist_ids ?? null,
        valid_from: m.valid_from,
        daily,
        total: today,
      };
    })
    .sort((a, b) => {
      const ad = a.daily ?? -1;
      const bd = b.daily ?? -1;
      if (bd !== ad) return bd - ad;
      return (b.total ?? 0) - (a.total ?? 0);
    })
    .slice(0, 200);

  // Removed meta (best-effort)
  const removedMetaByIsrc = new Map<string, TrackRow>();
  await Promise.all(
    chunk(removedIsrcs, 200).map(async (isrcChunk) => {
      const { data } = await sb
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
        .in("isrc", isrcChunk);
      for (const t of (data ?? []) as TrackRow[]) removedMetaByIsrc.set(t.isrc, t);
    }),
  );

  return (
    <PlaylistMetricProvider>
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            {playlistImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={playlistImageUrl}
                alt="Playlist cover"
                className="h-12 w-12 rounded-lg object-cover sb-ring"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg sb-ring bg-white/60" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {title}
                </h1>
                {spotifyUrl && (
                  <Link
                    href={spotifyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    title="Open on Spotify"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                {latestDate ? (
                  <>
                    Latest snapshot: <span className="font-mono">{formatDateISO(latestDate)}</span>
                  </>
                ) : (
                  "No stats found for this playlist yet."
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PlaylistHeaderWithSelector />
            <Link
              href="/playlists/config"
              className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
              aria-label="Playlist config"
              title="Playlist config"
            >
              <List className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
            </Link>
          </div>
        </div>

        <PlaylistDashboardControls
          playlists={playlistOptions}
          playlistKey={playlistKey}
          rangeDays={rangeDays}
        />

        <PlaylistPageClient
          latest={latest as PlaylistDailyStatsRow | null}
          latestDate={latestDate}
          rangeDays={rangeDays}
          history={hist}
          removedTracksCount={removed.length}
          playlistKey={playlistKey}
        />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <h2 className="text-sm font-semibold">Tracks currently in playlist</h2>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Daily streams are best-effort (requires catalog snapshot).
            </div>
          </div>
          <GlassTable headers={["", "Track", "ISRC", "Daily", "Total", "Added"]}>
            {currentRows.map((t) => (
              <TableRow key={t.isrc}>
                <TableCell>
                  {t.img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.img}
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
                  {t.artists?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks
                        artistNames={t.artists}
                        artistIds={t.artistIds ?? undefined}
                      />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                  {t.isrc}
                </TableCell>
                <TableCell className="font-medium text-lime-700 dark:text-lime-400">
                  {t.daily === null ? "—" : `+${formatInt(t.daily)}`}
                </TableCell>
                <TableCell>{t.total === null ? "—" : formatInt(t.total)}</TableCell>
                <TableCell mono className="text-xs">
                  {formatDateISO(t.valid_from)}
                </TableCell>
              </TableRow>
            ))}
            {!currentRows.length && (
              <EmptyState colSpan={6} message="No active tracks found" />
            )}
          </GlassTable>
        </div>

        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <h2 className="text-sm font-semibold">Tracks removed</h2>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Most recent removals first.
            </div>
          </div>
          <GlassTable headers={["Track", "ISRC", "Removed", "Added"]}>
            {removed.map((m, idx) => {
              const meta = removedMetaByIsrc.get(m.isrc);
              return (
                <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                  <TableCell>
                    <Link
                      href={`/tracks/${m.isrc}`}
                      className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                    >
                      {meta?.name ?? m.isrc}
                    </Link>
                    {meta?.spotify_artist_names?.length ? (
                      <div className="mt-0.5 text-xs opacity-60">
                        <ArtistLinks
                          artistNames={meta.spotify_artist_names}
                          artistIds={meta.spotify_artist_ids ?? undefined}
                        />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell mono className="text-xs">
                    {m.isrc}
                  </TableCell>
                  <TableCell mono className="text-xs">
                    {m.valid_to ? formatDateISO(m.valid_to) : "—"}
                  </TableCell>
                  <TableCell mono className="text-xs">
                    {formatDateISO(m.valid_from)}
                  </TableCell>
                </TableRow>
              );
            })}
            {!removed.length && (
              <EmptyState colSpan={4} message="No removed tracks found" />
            )}
          </GlassTable>
        </div>
      </div>
      </div>
    </PlaylistMetricProvider>
  );
}
