import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseService } from "@/lib/supabase/service";
import { cachedQueries } from "@/lib/supabase/cache";
import { formatDateISO, formatInt } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { SectionHeader } from "@/components/ui/SectionHeader";

function errorMessage(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.message;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" ? msg : String(err);
}

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

type DebugCounts = {
  totalRows: number | null;
  nullValidToRows: number | null;
  activeAtRunDateRows: number | null;
  maxValidFrom: string | null;
  minValidFrom: string | null;
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
          <SectionHeader title="Tracks currently in playlist" />
          <GlassTable headers={["", "Track", "ISRC", "Daily", "Total", "Added"]}>
            <EmptyState colSpan={6} message="No stats date available yet" />
          </GlassTable>
        </div>
      </div>
    );
  }

  // NOTE: This cache stores *both data and errors*. When we change playlist RPCs,
  // we must bump this version to avoid serving stale cached error payloads.
  const cacheKeyBase = `playlist-tables-v2-${props.playlistKey}-${props.latestRunDate}-${props.prevRunDate ?? "none"}`;

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
  const topErr = results.top.error;
  const addedErr = results.added.error;
  const removedErr = results.removed.error;

  const debug: DebugCounts | null = await (async () => {
    // Only compute when something looks wrong (keeps page fast).
    if (!topErr && currentRows.length) return null;
    const runDate = props.latestRunDate!;
    const key = props.playlistKey;

    // Use lightweight COUNT(head:true) queries.
    const [total, nullValidTo, active] = await Promise.all([
      svc.from("playlist_memberships").select("isrc", { count: "exact", head: true }).eq("playlist_key", key),
      svc
        .from("playlist_memberships")
        .select("isrc", { count: "exact", head: true })
        .eq("playlist_key", key)
        .is("valid_to", null),
      svc
        .from("playlist_memberships")
        .select("isrc", { count: "exact", head: true })
        .eq("playlist_key", key)
        .lte("valid_from", runDate)
        .or(`valid_to.is.null,valid_to.gte.${runDate}`),
    ]);

    // Range info (best-effort).
    const { data: minRow } = await svc
      .from("playlist_memberships")
      .select("valid_from")
      .eq("playlist_key", key)
      .order("valid_from", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: maxRow } = await svc
      .from("playlist_memberships")
      .select("valid_from")
      .eq("playlist_key", key)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      totalRows: total.count ?? null,
      nullValidToRows: nullValidTo.count ?? null,
      activeAtRunDateRows: active.count ?? null,
      minValidFrom:
        typeof (minRow as Record<string, unknown> | null)?.valid_from === "string"
          ? ((minRow as Record<string, unknown>).valid_from as string)
          : null,
      maxValidFrom:
        typeof (maxRow as Record<string, unknown> | null)?.valid_from === "string"
          ? ((maxRow as Record<string, unknown>).valid_from as string)
          : null,
    };
  })();

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="space-y-3">
        <SectionHeader title="Tracks currently in playlist" />
        {debug ? (
          <details
            className="rounded-xl border px-3 py-2 text-xs"
            style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
          >
            <summary className="cursor-pointer select-none">Debug: playlist_memberships snapshot</summary>
            <div className="mt-2 grid grid-cols-1 gap-1 font-mono">
              <div>playlist_key={props.playlistKey}</div>
              <div>run_date={props.latestRunDate}</div>
              <div>rows_total={debug.totalRows ?? "?"}</div>
              <div>rows_valid_to_null={debug.nullValidToRows ?? "?"}</div>
              <div>rows_active_at_run_date={debug.activeAtRunDateRows ?? "?"}</div>
              <div>valid_from_min={debug.minValidFrom ?? "?"}</div>
              <div>valid_from_max={debug.maxValidFrom ?? "?"}</div>
            </div>
          </details>
        ) : null}
        <GlassTable headers={["", "Track", "ISRC", "Daily", "Total", "Added"]}>
          {topErr ? (
            <EmptyState
              colSpan={6}
              message={`Error loading current tracks: ${errorMessage(topErr)}`}
            />
          ) : null}
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
          {!topErr && !currentRows.length && <EmptyState colSpan={6} message="No active tracks found" />}
        </GlassTable>
      </div>

      <div className="flex h-full flex-col gap-3">
        <div className="space-y-3">
          <SectionHeader
            title="Tracks added (last 7 days)"
            subtitle="Based on membership added date."
          />
          <GlassTable headers={["", "Track", "ISRC", "Added"]} maxBodyHeightClassName="max-h-[260px]">
            {addedErr ? (
              <EmptyState
                colSpan={4}
                message={`Error loading added tracks: ${errorMessage(addedErr)}`}
              />
            ) : null}
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
            {!addedErr && !addedLast7Days.length && (
              <EmptyState colSpan={4} message="No tracks added in the last 7 days" />
            )}
          </GlassTable>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <SectionHeader
            title="Tracks removed"
            subtitle="Most recent removals first."
          />
          <GlassTable
            className="flex-1"
            bodyClassName="flex-1"
            maxBodyHeightClassName="flex-1"
            headers={["", "Track", "ISRC", "Removed", "Added"]}
          >
            {removedErr ? (
              <EmptyState
                colSpan={5}
                message={`Error loading removed tracks: ${errorMessage(removedErr)}`}
              />
            ) : null}
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
            {!removedErr && !removed.length && <EmptyState colSpan={5} message="No removed tracks found" />}
          </GlassTable>
        </div>
      </div>
    </div>
  );
}

