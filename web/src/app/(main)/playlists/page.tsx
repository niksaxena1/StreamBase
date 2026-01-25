import Link from "next/link";
import { Activity, ListMusic } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { formatDateISO, formatInt } from "@/lib/format";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { StatCard } from "@/components/StatCard";
import { PlaylistDashboardControls } from "@/components/dashboard/PlaylistDashboardControls";
import { RememberParamRedirect } from "@/components/dashboard/RememberParamRedirect";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";

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

function rollingAvg7(desc: Array<{ date: string; daily: number }>) {
  // Input: newest-first. Output: newest-first with ma7.
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; daily: number; ma7: number | null }> = [];

  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.daily ?? 0));
    const has7 = window.length >= 7;
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, daily: asc[i].daily, ma7: has7 ? avg : null });
  }

  return outAsc.reverse();
}

export default async function PlaylistsPage({
  searchParams,
}: {
  searchParams?: Promise<{ playlist_key?: string; range?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const playlistKey = (sp.playlist_key ?? "").trim();
  const rangeDays = clampRangeDays(sp.range);

  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");

  // If no playlist_key is provided, show the list view
  if (!playlistKey) {
    const { data, error } = await sb
      .from("playlists")
      .select(
        "playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at",
      )
      .order("is_catalog", { ascending: false })
      .order("display_name", { ascending: true });

    const playlists = (data ?? []) as PlaylistRow[];

    // Best-effort thumbnail refresh for rows that have spotify_playlist_id but no image (or stale).
    // We keep this conservative to avoid spamming Spotify requests.
    try {
      const candidates = playlists.filter(
        (p) => Boolean(p.spotify_playlist_id) && !p.spotify_playlist_image_url,
      );

      if (candidates.length) {
        const svc = supabaseService();
        // refresh up to 3 per request
        for (const p of candidates.slice(0, 3)) {
          const id = p.spotify_playlist_id;
          if (!id) continue;
          const meta = await getPlaylist(id);
          await svc
            .from("playlists")
            .update({
              spotify_playlist_name: meta.name,
              spotify_playlist_image_url: meta.imageUrl,
              spotify_last_fetched_at: new Date().toISOString(),
            })
            .eq("playlist_key", p.playlist_key);
          p.spotify_playlist_image_url = meta.imageUrl;
        }
      }
    } catch {
      // ignore refresh errors
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Playlists
            </h1>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Tracked playlists from configuration.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Link
                href="/settings/playlists"
                className="sb-ring rounded-full bg-white/60 px-3 py-1.5 text-xs font-medium transition hover:bg-white/80"
              >
                Settings
              </Link>
            ) : null}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
            Query error: {error.message}
          </div>
        )}

        <GlassTable headers={["", "Key", "Name", "Type"]}>
          {playlists.map((p) => (
            <TableRow key={p.playlist_key}>
              <TableCell>
                {p.spotify_playlist_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.spotify_playlist_image_url}
                    alt="Playlist cover"
                    className="h-8 w-8 rounded-lg object-cover sb-ring"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                )}
              </TableCell>
              <TableCell mono>
                <Link
                  className="transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium"
                  href={`/playlists?playlist_key=${encodeURIComponent(p.playlist_key)}`}
                >
                  {p.playlist_key}
                </Link>
              </TableCell>
              <TableCell>
                <span className="font-medium">{p.display_name}</span>
              </TableCell>
              <TableCell>
                {p.is_catalog ? (
                  <span className="inline-flex items-center rounded-full bg-lime-400/20 px-2.5 py-0.5 text-xs font-medium text-lime-800 dark:text-lime-300">
                    Catalog
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                    Standard
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!playlists.length && (
            <TableRow>
              <TableCell className="text-center opacity-50 py-8" colSpan={4}>
                No playlists found.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
      </div>
    );
  }

  // Dashboard view - show analytics for selected playlist
  const [{ data: playlists }, { data: latest }, { data: prev }, { data: history }] =
    await Promise.all([
      sb
        .from("playlists")
        .select("playlist_key,display_name,is_catalog")
        .order("is_catalog", { ascending: false })
        .order("display_name", { ascending: true }),
      sb
        .from("playlist_daily_stats")
        .select("date,track_count,total_streams_cumulative,daily_streams_net")
        .eq("playlist_key", playlistKey)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("playlist_daily_stats")
        .select("date")
        .eq("playlist_key", playlistKey)
        .order("date", { ascending: false })
        .range(1, 1)
        .maybeSingle(),
      sb
        .from("playlist_daily_stats")
        .select("date,track_count,total_streams_cumulative,daily_streams_net")
        .eq("playlist_key", playlistKey)
        .order("date", { ascending: false })
        .limit(rangeDays),
    ]);

  const playlistOptions = (playlists ?? []) as PlaylistRow[];
  const title =
    playlistOptions.find((p) => p.playlist_key === playlistKey)?.display_name ??
    playlistKey;

  const latestDate = latest?.date ?? null;
  const prevDate = prev?.date ?? null;

  const hist = (history ?? []) as PlaylistDailyStatsRow[];
  const cumulativeSeries = hist.map((r) => ({
    date: r.date,
    value: Number(r.total_streams_cumulative ?? 0),
  }));

  const dailyDesc = hist.map((r) => ({
    date: r.date,
    daily: Number(r.daily_streams_net ?? 0),
  }));
  const dailyWithMaDesc = rollingAvg7(dailyDesc);

  const trackCountSeries = hist.map((r) => ({
    date: r.date,
    value: Number(r.track_count ?? 0),
  }));

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
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Dashboard / Playlists
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {title}
          </h1>
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

      <PlaylistDashboardControls
        playlists={playlistOptions}
        playlistKey={playlistKey}
        rangeDays={rangeDays}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <SpotlightCard className="lg:col-span-7 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider opacity-60">
                <Activity className="h-3.5 w-3.5" />
                Cumulative streams
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latest?.total_streams_cumulative ?? 0} />
              </div>
              <div className="mt-1 text-xs opacity-60">{rangeDays} day view</div>
            </div>
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsChart
              data={cumulativeSeries}
              valueLabel="Total streams"
              valueFormat="int"
              yTickFormat="k"
              heightPx={220}
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="lg:col-span-5 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Daily streams (MA7)
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latest?.daily_streams_net ?? 0} />
              </div>
              <div className="mt-1 text-xs opacity-60">
                Newest day: {formatDateISO(latestDate)}
              </div>
            </div>
            <Link
              href={`/playlists/${playlistKey}`}
              className="sb-ring rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            >
              Detail
            </Link>
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsWithMAChart
              data={dailyWithMaDesc}
              valueLabel="Daily streams"
              valueFormat="int"
              yTickFormat="k"
              heightPx={220}
            />
          </div>
        </SpotlightCard>

        <StatCard
          title="Active tracks"
          value={<AnimatedCounter value={latest?.track_count ?? 0} />}
          subtitle="Currently in playlist"
        />
        <StatCard
          title="Top tracks (table)"
          value={formatInt(currentRows.length)}
          subtitle="Sorted by last-day streams"
        />
        <StatCard
          title="Removed tracks"
          value={formatInt(removed.length)}
          subtitle="Historical removals"
        />
        <SpotlightCard className="lg:col-span-12 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Track count over time
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                Daily snapshots from ingestion.
              </div>
            </div>
          </div>
          <div className="mt-2 min-h-[180px]">
            <DailyStreamsChart
              data={trackCountSeries}
              valueLabel="Tracks"
              valueFormat="int"
              yTickFormat="int"
              heightPx={200}
              color="#60a5fa"
            />
          </div>
        </SpotlightCard>
      </div>

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
                <TableCell mono className="text-xs">
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
  );
}
