import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseService } from "@/lib/supabase/service";
import { cachedQueries, cachedQuery } from "@/lib/supabase/cache";
import { PlaylistTracksSectionClient } from "./PlaylistTracksSectionClient";

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
  release_date?: string | null;
};

type PlaylistAddedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  release_date?: string | null;
};

type PlaylistRemovedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  valid_to: string | null;
  release_date?: string | null;
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
  /**
   * Cache-buster for re-ingestions/backfills that reuse the same run_date.
   * Prefer passing `playlist_daily_stats.source_run_id` for the latest run.
   */
  cacheBuster?: string | null;
}) {
  const svc = supabaseService();

  if (!props.latestRunDate) {
    return (
      <PlaylistTracksSectionClient
        playlistKey={props.playlistKey}
        latestRunDate={props.latestRunDate}
        currentRows={[]}
        addedLast7Days={[]}
        removed={[]}
        topErrMessage={null}
        addedErrMessage={null}
        removedErrMessage={null}
        debug={null}
      />
    );
  }

  // NOTE: This cache stores *both data and errors*. When we change playlist RPCs,
  // we must bump this version to avoid serving stale cached error payloads.
  const cacheKeyBase = `playlist-tables-v4-${props.playlistKey}-${props.latestRunDate}-${props.prevRunDate ?? "none"}-${props.cacheBuster ?? "none"}`;

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

  // Add track release dates (UI wants release dates instead of ISRC).
  // Do this as a single batched query (avoids touching DB RPCs).
  const releaseDateByIsrc = await (async () => {
    const all = [...currentRows, ...addedLast7Days, ...removed];
    const isrcs = Array.from(new Set(all.map((r) => String((r as any)?.isrc ?? "").trim()).filter(Boolean)));
    if (!isrcs.length) return new Map<string, string | null>();

    const sorted = [...isrcs].sort((a, b) => a.localeCompare(b));
    const sig = `${sorted.length}:${sorted.slice(0, 3).join(",")}:${sorted.slice(-3).join(",")}`;

    const { data } = await cachedQuery(
      async () =>
        await svc
          .from("tracks")
          .select("isrc,release_date")
          .in("isrc", isrcs)
          .limit(5000),
      `playlist-track-release-dates-v1-${props.playlistKey}-${props.latestRunDate}-${sig}`,
      86400,
    );

    const map = new Map<string, string | null>();
    for (const r of (data ?? []) as Array<{ isrc: string; release_date: string | null }>) {
      const key = String(r?.isrc ?? "").trim();
      if (!key) continue;
      map.set(key, (r?.release_date ?? null) as string | null);
    }
    return map;
  })();

  const currentRowsWithRelease = currentRows.map((r) => ({
    ...r,
    release_date: releaseDateByIsrc.get(r.isrc) ?? null,
  }));
  const addedLast7DaysWithRelease = addedLast7Days.map((r) => ({
    ...r,
    release_date: releaseDateByIsrc.get(r.isrc) ?? null,
  }));
  const removedWithRelease = removed.map((r) => ({
    ...r,
    release_date: releaseDateByIsrc.get(r.isrc) ?? null,
  }));

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
    <PlaylistTracksSectionClient
      playlistKey={props.playlistKey}
      latestRunDate={props.latestRunDate}
      currentRows={currentRowsWithRelease}
      addedLast7Days={addedLast7DaysWithRelease}
      removed={removedWithRelease}
      topErrMessage={topErr ? errorMessage(topErr) : null}
      addedErrMessage={addedErr ? errorMessage(addedErr) : null}
      removedErrMessage={removedErr ? errorMessage(removedErr) : null}
      debug={debug}
    />
  );
}

