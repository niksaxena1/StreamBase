import Link from "next/link";

import { Sparkline } from "@/components/charts/Sparkline";
import { formatInt } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { findTrackByIsrc } from "@/lib/spotify";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

export const dynamic = "force-dynamic";

type TrackRow = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  first_seen: string | null;
  last_seen: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_artist_ids: string[] | null;
  spotify_track_id: string | null;
};

type SpotifyMeta = {
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
  spotify_artist_ids: string[] | null;
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
  const spotifyEnvOk = Boolean(
    process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET,
  );
  const serviceEnvOk = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  let spotifyLookupError: string | null = null;
  let spotifyCacheError: string | null = null;
  let spotifyAttempted = false;


  const { data: track, error: trackErr } = await sb
    .from("tracks")
    .select(
      "isrc,name,release_date,first_seen,last_seen,spotify_album_image_url,spotify_artist_names,spotify_artist_ids,spotify_track_id",
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
          spotify_artist_ids: trackRow.spotify_artist_ids ?? null,
          spotify_track_id: trackRow.spotify_track_id ?? null,
        }
      : null;

  try {
    const missing = !spotify?.spotify_album_image_url || !(spotify.spotify_artist_names?.length);

    if (trackRow?.isrc && missing && spotifyEnvOk) {
      spotifyAttempted = true;
      const hit = await findTrackByIsrc(trackRow.isrc);
      if (hit) {
        spotify = {
          spotify_album_image_url: hit.albumImageUrl,
          spotify_artist_names: hit.artistNames,
          spotify_artist_ids: hit.artistIds,
          spotify_track_id: hit.trackId,
        };

        // Best-effort cache write. Even if this fails, we still show the fetched data.
        if (serviceEnvOk) {
          try {
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
          } catch (err) {
            spotifyCacheError = err instanceof Error ? err.message : String(err);
          }
        } else {
          spotifyCacheError =
            "Spotify cache write disabled: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.";
        }
      }
    }
  } catch (err) {
    spotifyLookupError = err instanceof Error ? err.message : String(err);
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
    <div className="space-y-4">
      <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
        <Link className="underline" href="/tracks">
          Tracks
        </Link>{" "}
        / <span className="font-mono">{isrc}</span>
      </div>


      {isAdmin && trackRow?.isrc && !spotify?.spotify_artist_names?.length && !spotify?.spotify_album_image_url ? (
        <div className="space-y-2 rounded-2xl border border-blue-300 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900/30 dark:bg-blue-900/10 dark:text-blue-200">
          {!spotifyEnvOk ? (
            <div>
              Spotify enrichment is <span className="font-semibold">not configured</span>. Missing{" "}
              <span className="font-mono">SPOTIFY_CLIENT_ID</span> and/or{" "}
              <span className="font-mono">SPOTIFY_CLIENT_SECRET</span>.
            </div>
          ) : spotifyLookupError ? (
            <div>
              Spotify lookup failed: <span className="font-mono">{spotifyLookupError}</span>
            </div>
          ) : spotifyAttempted ? (
            <div>
              Spotify search returned no match for this ISRC (or hasn’t cached yet). Refreshing this page will retry.
            </div>
          ) : (
            <div>Spotify enrichment is enabled. Refreshing this page should attempt a lookup.</div>
          )}
          {spotifyCacheError ? (
            <div>
              Cache write note: <span className="font-mono">{spotifyCacheError}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-start gap-4">
            {spotify?.spotify_album_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={spotify.spotify_album_image_url}
                alt="Album cover"
                className="h-14 w-14 rounded-xl object-cover sb-ring"
              />
            ) : (
              <div className="h-14 w-14 rounded-xl sb-ring bg-white/60" />
            )}
            <div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {track?.name ?? isrc}
              </h1>
              <div className="mt-1 text-sm" style={{ color: "var(--sb-muted)" }}>
                ISRC: <span className="font-mono">{isrc}</span>
                {spotify?.spotify_artist_names?.length ? (
                  <>
                    {" "}
                    • Artists:{" "}
                    <ArtistLinks
                      artistNames={spotify.spotify_artist_names}
                      artistIds={spotify.spotify_artist_ids ?? undefined}
                    />
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

        <div className="sb-card px-4 py-3">
          <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
            Latest cumulative
          </div>
          <div className="mt-1 text-xl font-semibold">
            {latest !== null ? formatInt(Number(latest)) : "—"}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Daily growth: {daily !== null ? formatInt(daily) : "—"}
          </div>
        </div>
      </div>

      {(trackErr || seriesErr) && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {trackErr?.message ?? seriesErr?.message ?? "unknown"}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="sb-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Streams over time</div>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Last {Math.min(120, series?.length ?? 0)} days
              </div>
            </div>
          </div>
          <div className="mt-2 overflow-x-auto">
            <div className="h-[120px] w-full">
              <Sparkline data={sparkValues} />
            </div>
          </div>
        </div>

        <div className="sb-card p-4">
          <div className="text-sm font-medium">Current memberships</div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Playlists where this track is active right now
          </div>
          <div className="mt-2 space-y-2">
            {(currentMemberships ?? []).map((m) => (
              <div
                key={m.playlist_key}
                className="sb-ring flex items-center justify-between rounded-xl bg-white/60 px-3 py-2"
              >
                <Link className="underline text-xs" href={`/playlists/${m.playlist_key}`}>
                  {m.playlist_key}
                </Link>
                <span className="font-mono text-[11px]" style={{ color: "var(--sb-muted)" }}>
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

      <div className="sb-card overflow-hidden">
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--sb-border)" }}>
          <div className="text-sm font-medium">Membership timeline</div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Added/removed intervals per playlist
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left text-[11px]" style={{ color: "var(--sb-muted)" }}>
              <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
                <th className="px-4 py-2 font-medium">Playlist</th>
                <th className="px-4 py-2 font-medium">Valid from</th>
                <th className="px-4 py-2 font-medium">Valid to</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((h, i) => (
                <tr
                  key={`${h.playlist_key}-${h.valid_from}-${i}`}
                  className="border-b last:border-0"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <td className="px-4 py-2">
                    <Link className="underline" href={`/playlists/${h.playlist_key}`}>
                      {h.playlist_key}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{h.valid_from}</td>
                  <td className="px-4 py-2 font-mono text-[11px]">{h.valid_to ?? "—"}</td>
                </tr>
              ))}
              {!history?.length && (
                <tr>
                  <td
                    className="px-4 py-6 text-sm"
                    style={{ color: "var(--sb-muted)" }}
                    colSpan={3}
                  >
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

