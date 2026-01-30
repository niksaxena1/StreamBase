import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseService } from "@/lib/supabase/service";
import { cachedQueries } from "@/lib/supabase/cache";
import { formatDateISO, formatInt } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

type PlaylistTopTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  total: number | null;
  daily: number | null;
};

type PlaylistAddedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
};

type PlaylistRemovedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  valid_to: string | null;
};

async function rpcTopTracks(
  svc: SupabaseClient,
  args: { playlistKey: string; runDate: string; prevDate: string | null },
) {
  return svc.rpc("playlist_top_tracks", {
    playlist_key: args.playlistKey,
    run_date: args.runDate,
    prev_date: args.prevDate,
    limit_rows: 200,
  });
}

async function rpcAddedTracks(svc: SupabaseClient, args: { playlistKey: string; runDate: string }) {
  return svc.rpc("playlist_added_tracks", {
    playlist_key: args.playlistKey,
    run_date: args.runDate,
    days: 7,
    limit_rows: 200,
  });
}

async function rpcRemovedTracks(svc: SupabaseClient, args: { playlistKey: string }) {
  return svc.rpc("playlist_removed_tracks", {
    playlist_key: args.playlistKey,
    limit_rows: 500,
  });
}

export async function PlaylistTracksSection(props: {
  playlistKey: string;
  latestRunDate: string | null;
  prevRunDate: string | null;
}) {
  const svc = supabaseService();

  if (!props.latestRunDate) {
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <h2 className="text-sm font-semibold">Tracks currently in playlist</h2>
          </div>
          <GlassTable headers={["", "Track", "ISRC", "Daily", "Total", "Added"]}>
            <EmptyState colSpan={6} message="No stats date available yet" />
          </GlassTable>
        </div>
      </div>
    );
  }

  const cacheKeyBase = `playlist-tables-v1-${props.playlistKey}-${props.latestRunDate}-${props.prevRunDate ?? "none"}`;

  const results = await cachedQueries<{
    top: PlaylistTopTrackRow[];
    added: PlaylistAddedRow[];
    removed: PlaylistRemovedRow[];
  }>(
    {
      top: async () => {
        const { data, error } = await rpcTopTracks(svc, {
          playlistKey: props.playlistKey,
          runDate: props.latestRunDate!,
          prevDate: props.prevRunDate,
        });
        return { data: (data ?? []) as PlaylistTopTrackRow[], error };
      },
      added: async () => {
        const { data, error } = await rpcAddedTracks(svc, {
          playlistKey: props.playlistKey,
          runDate: props.latestRunDate!,
        });
        return { data: (data ?? []) as PlaylistAddedRow[], error };
      },
      removed: async () => {
        const { data, error } = await rpcRemovedTracks(svc, { playlistKey: props.playlistKey });
        return { data: (data ?? []) as PlaylistRemovedRow[], error };
      },
    },
    cacheKeyBase,
    86400,
  );

  const currentRows = results.top.data ?? [];
  const addedLast7Days = results.added.data ?? [];
  const removed = results.removed.data ?? [];

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <h2 className="text-sm font-semibold">Tracks currently in playlist</h2>
        </div>
        <GlassTable headers={["", "Track", "ISRC", "Daily", "Total", "Added"]}>
          {currentRows.map((t) => (
            <TableRow key={t.isrc}>
              <TableCell>
                {t.album_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.album_image_url}
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
                {t.artist_names?.length ? (
                  <div className="mt-0.5 text-xs opacity-60">
                    <ArtistLinks artistNames={t.artist_names} artistIds={t.artist_ids ?? undefined} />
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
          {!currentRows.length && <EmptyState colSpan={6} message="No active tracks found" />}
        </GlassTable>
      </div>

      <div className="flex h-full flex-col gap-3">
        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <h2 className="text-sm font-semibold">Tracks added (last 7 days)</h2>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Based on membership added date.
            </div>
          </div>
          <GlassTable headers={["", "Track", "ISRC", "Added"]} maxBodyHeightClassName="max-h-[260px]">
            {addedLast7Days.map((m, idx) => (
              <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                <TableCell>
                  {m.album_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.album_image_url}
                      alt="Album cover"
                      className="h-8 w-8 rounded-lg object-cover sb-ring"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/tracks/${m.isrc}`}
                    className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {m.name ?? m.isrc}
                  </Link>
                  {m.artist_names?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks artistNames={m.artist_names} artistIds={m.artist_ids ?? undefined} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                  {m.isrc}
                </TableCell>
                <TableCell mono className="text-xs">
                  {formatDateISO(m.valid_from)}
                </TableCell>
              </TableRow>
            ))}
            {!addedLast7Days.length && <EmptyState colSpan={4} message="No tracks added in the last 7 days" />}
          </GlassTable>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-end justify-between px-1">
            <h2 className="text-sm font-semibold">Tracks removed</h2>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Most recent removals first.
            </div>
          </div>
          <GlassTable
            className="flex-1"
            bodyClassName="flex-1"
            maxBodyHeightClassName="flex-1"
            headers={["", "Track", "ISRC", "Removed", "Added"]}
          >
            {removed.map((m, idx) => (
              <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                <TableCell>
                  {m.album_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.album_image_url}
                      alt="Album cover"
                      className="h-8 w-8 rounded-lg object-cover sb-ring"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/tracks/${m.isrc}`}
                    className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {m.name ?? m.isrc}
                  </Link>
                  {m.artist_names?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks artistNames={m.artist_names} artistIds={m.artist_ids ?? undefined} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                  {m.isrc}
                </TableCell>
                <TableCell mono className="text-xs">
                  {m.valid_to ? formatDateISO(m.valid_to) : "—"}
                </TableCell>
                <TableCell mono className="text-xs">
                  {formatDateISO(m.valid_from)}
                </TableCell>
              </TableRow>
            ))}
            {!removed.length && <EmptyState colSpan={5} message="No removed tracks found" />}
          </GlassTable>
        </div>
      </div>
    </div>
  );
}

