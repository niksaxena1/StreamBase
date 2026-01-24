import Link from "next/link";

import { Sparkline } from "@/components/charts/Sparkline";
import { formatInt } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { findTrackByIsrc } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type TrackRow = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  first_seen: string | null;
  last_seen: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_track_id: string | null;
};

type SpotifyMeta = {
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_track_id: string | null;
};

export default async function TrackDetailPage({
  params,
}: {
  params: Promise<{ isrc: string }>;
}) {
  const { isrc } = await params;
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");

  const missingEnv: string[] = [];
  if (!process.env.SPOTIFY_CLIENT_ID) missingEnv.push("SPOTIFY_CLIENT_ID");
  if (!process.env.SPOTIFY_CLIENT_SECRET) missingEnv.push("SPOTIFY_CLIENT_SECRET");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");

  const { data: track, error: trackErr } = await sb
    .from("tracks")
    .select(
      "isrc,name,release_date,first_seen,last_seen,spotify_album_image_url,spotify_artist_names,spotify_track_id",
    )
    .eq("isrc", isrc)
    .maybeSingle();

  // Best-effort Spotify enrichment (server-side) if missing/stale.
  // This is safe because it writes using the Supabase service role key server-side only.
  const trackRow = (track ?? null) as TrackRow | null;
  let spotify: SpotifyMeta | null =
    trackRow
      ? {
          spotify_album_image_url: trackRow.spotify_album_image_url ?? null,
          spotify_artist_names: trackRow.spotify_artist_names ?? null,
          spotify_track_id: trackRow.spotify_track_id ?? null,
        }
      : null;

  try {
    const missing = !spotify?.spotify_album_image_url || !(spotify.spotify_artist_names?.length);

    if (trackRow?.isrc && missing) {
      const hit = await findTrackByIsrc(trackRow.isrc);
      if (hit) {
        const svc = supabaseService();
        await svc
          .from("tracks")
          .update({
            spotify_track_id: hit.trackId,
            spotify_album_id: hit.albumId,
            spotify_album_name: hit.albumName,
            spotify_album_image_url: hit.albumImageUrl,
            spotify_artist_ids: hit.artistIds,
            spotify_artist_names: hit.artistNames,
            spotify_last_fetched_at: new Date().toISOString(),
          })
          .eq("isrc", trackRow.isrc);

        spotify = {
          spotify_album_image_url: hit.albumImageUrl,
          spotify_artist_names: hit.artistNames,
          spotify_track_id: hit.trackId,
        };
      }
    }
  } catch {
    // ignore enrichment errors (page still renders)
  }

  const { data: series, error: seriesErr } = await sb
    .from("track_daily_streams")
    .select("date,streams_cumulative")
    .eq("isrc", isrc)
    .order("date", { ascending: false })
    .limit(120);

  const { data: currentMemberships } = await sb
    .from("playlist_memberships")
    .select("playlist_key,valid_from")
    .eq("isrc", isrc)
    .is("valid_to", null)
    .order("playlist_key", { ascending: true })
    .limit(200);

  const { data: history } = await sb
    .from("playlist_memberships")
    .select("playlist_key,valid_from,valid_to")
    .eq("isrc", isrc)
    .order("playlist_key", { ascending: true })
    .order("valid_from", { ascending: false })
    .limit(300);

  const latest = series?.[0]?.streams_cumulative ?? null;
  const sparkValues = (series ?? [])
    .slice()
    .reverse()
    .map((r) => Number(r.streams_cumulative ?? 0));

  // Daily delta (latest - prev) for quick glance
  const prev = series?.[1]?.streams_cumulative ?? null;
  const daily = latest !== null && prev !== null ? Number(latest) - Number(prev) : null;

  return (
    <div className="space-y-6">
      <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
        <Link className="underline" href="/tracks">
          Tracks
        </Link>{" "}
        / <span className="font-mono">{isrc}</span>
      </div>

      {isAdmin && missingEnv.length ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-200">
          Spotify enrichment is disabled: missing{" "}
          <span className="font-mono">{missingEnv.join(", ")}</span> in Vercel env vars.
        </div>
      ) : null}

      {isAdmin && !missingEnv.length && trackRow?.isrc && !spotify?.spotify_artist_names?.length && !spotify?.spotify_album_image_url ? (
        <div className="rounded-2xl border border-blue-300 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-200">
          Spotify enrichment is configured, but this ISRC hasn’t cached yet (or Spotify search returned no match). Refreshing this page should attempt a lookup.
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-start gap-4">
            {spotify?.spotify_album_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={spotify.spotify_album_image_url}
                alt="Album cover"
                className="h-16 w-16 rounded-2xl object-cover sb-ring"
              />
            ) : (
              <div className="h-16 w-16 rounded-2xl sb-ring bg-white/60" />
            )}
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {track?.name ?? isrc}
              </h1>
              <div className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
                ISRC: <span className="font-mono">{isrc}</span>
                {spotify?.spotify_artist_names?.length ? (
                  <>
                    {" "}
                    • Artists:{" "}
                    {spotify.spotify_artist_names.map((a, idx) => (
                      <span key={`${a}-${idx}`}>
                        <span className="font-medium text-black/80">{a}</span>
                        {idx < spotify.spotify_artist_names!.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </>
                ) : null}
                {track?.release_date ? (
                  <>
                    {" "}
                    • Release: <span className="font-mono">{track.release_date}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="sb-card rounded-[28px] px-5 py-4">
          <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
            Latest cumulative
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {latest !== null ? formatInt(Number(latest)) : "—"}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Daily growth: {daily !== null ? formatInt(daily) : "—"}
          </div>
        </div>
      </div>

      {(trackErr || seriesErr) && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
          Query error: {trackErr?.message ?? seriesErr?.message ?? "unknown"}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="sb-card rounded-[28px] p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Streams over time</div>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Last {Math.min(120, series?.length ?? 0)} days
              </div>
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Sparkline values={sparkValues} width={520} height={120} />
          </div>
        </div>

        <div className="sb-card rounded-[28px] p-5">
          <div className="text-sm font-medium">Current memberships</div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Playlists where this track is active right now
          </div>
          <div className="mt-4 space-y-2">
            {(currentMemberships ?? []).map((m) => (
              <div
                key={m.playlist_key}
                className="sb-ring flex items-center justify-between rounded-2xl bg-white/60 px-4 py-3"
              >
                <Link className="underline text-sm" href={`/playlists/${m.playlist_key}`}>
                  {m.playlist_key}
                </Link>
                <span className="font-mono text-xs" style={{ color: "var(--sb-muted)" }}>
                  since {m.valid_from}
                </span>
              </div>
            ))}
            {!currentMemberships?.length && (
              <div className="text-sm" style={{ color: "var(--sb-muted)" }}>
                Not currently in any tracked playlist.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sb-card overflow-hidden rounded-[28px]">
        <div className="border-b px-5 py-4" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-sm font-medium">Membership timeline</div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Added/removed intervals per playlist
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs" style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
                <th className="px-5 py-3 font-medium">Playlist</th>
                <th className="px-5 py-3 font-medium">Valid from</th>
                <th className="px-5 py-3 font-medium">Valid to</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h, i) => (
                <tr
                  key={`${h.playlist_key}-${h.valid_from}-${i}`}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <td className="px-5 py-3">
                    <Link className="underline" href={`/playlists/${h.playlist_key}`}>
                      {h.playlist_key}
                    </Link>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">{h.valid_from}</td>
                  <td className="px-5 py-3 font-mono text-xs">{h.valid_to ?? "—"}</td>
                </tr>
              ))}
              {!history?.length && (
                <tr>
                  <td className="px-5 py-8 text-sm" style={{ color: "var(--sb-muted)" }} colSpan={3}>
                    No membership history found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

