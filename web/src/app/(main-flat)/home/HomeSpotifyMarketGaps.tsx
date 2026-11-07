import Link from "@/components/shell/RouteLink";
import { SpotifyIconLink } from "@/components/spotify/SpotifyIconLink";

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { MarketChipList, MarketCountrySummary, MarketCoverage } from "@/components/spotify/SpotifyMarketParts";
import {
  cachedSpotifyMarketAvailability,
  type SpotifyMarketRestrictedTrack,
} from "@/lib/health/spotifyMarketAvailability";
import { formatScanTime, tallyMarkets, unusualReasonSummary } from "@/lib/health/spotifyMarketFormat";
import { HOME_DETAILS_STORAGE } from "./homeUtils";

const MAX_ROWS_PER_GROUP = 100;

function GapRow({ track }: { track: SpotifyMarketRestrictedTrack }) {
  const unusual = unusualReasonSummary(track.unavailable_reasons);
  const everywhere = track.available_count === 0;
  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 py-2.5 md:grid-cols-[auto_minmax(12rem,1fr)_minmax(0,1.4fr)_auto]">
      {track.album_image_url ? (
        <PreviewableArtwork
          src={track.album_image_url}
          alt="Album cover"
          width={40}
          height={40}
          className="h-10 w-10 rounded object-cover sb-ring flex-shrink-0"
          label={track.name || track.isrc}
        />
      ) : (
        <div className="h-10 w-10 rounded sb-ring bg-white/60 flex-shrink-0" />
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-1 text-sm leading-snug">
          {track.artist_names && track.artist_names.length > 0 ? (
            <>
              <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
              <span style={{ color: "var(--sb-muted)" }}>–</span>
            </>
          ) : null}
          <Link href={`/tracks/${track.isrc}`} className="font-medium hover:underline" style={{ color: "var(--sb-text)" }}>
            {track.name || track.isrc}
          </Link>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
          <CopyableIsrc isrc={track.isrc} className="font-mono text-[10px] text-lime-600 underline hover:opacity-80 dark:text-lime-400" />
          <SpotifyIconLink trackId={track.spotify_track_id} label={track.name ?? undefined} />
          {unusual ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{unusual}</span> : null}
        </div>
      </div>
      <div className="col-span-2 md:col-span-1">
        {everywhere ? (
          <span className="text-xs text-red-700 dark:text-red-300">Not playable in any territory</span>
        ) : (
          <MarketChipList markets={track.unavailable_markets} reasons={track.unavailable_reasons} />
        )}
      </div>
      <MarketCoverage
        available={track.available_count}
        checked={track.markets_checked}
        className="col-span-2 md:col-span-1 md:justify-self-end"
      />
    </li>
  );
}

function GapGroup({ title, hint, tracks }: { title: string; hint: string; tracks: SpotifyMarketRestrictedTrack[] }) {
  if (tracks.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2 border-b pb-1.5" style={{ borderColor: "var(--sb-border)" }}>
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
          {title}
        </span>
        <span className="rounded-full bg-black/5 px-1.5 font-mono text-[10px] tabular-nums dark:bg-white/10">{tracks.length}</span>
        <span className="text-[11px]" style={{ color: "var(--sb-muted)" }}>{hint}</span>
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--sb-border)" }}>
        {tracks.slice(0, MAX_ROWS_PER_GROUP).map((t) => (
          <GapRow key={t.isrc} track={t} />
        ))}
      </ul>
      {tracks.length > MAX_ROWS_PER_GROUP ? (
        <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          Showing {MAX_ROWS_PER_GROUP} of {tracks.length}. The full list is on Health.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Own-catalog Home: collapsed list of tracks with Spotify market gaps from the weekly scan.
 * Loaded separately (cached loader, inside Suspense) so it never touches the home snapshot path.
 * Renders nothing before the first scan or when no track is restricted.
 */
export async function HomeSpotifyMarketGaps() {
  let restricted: SpotifyMarketRestrictedTrack[] = [];
  let lastCheckedAt: string | null = null;
  try {
    const { data } = await cachedSpotifyMarketAvailability();
    if (!data || !data.lastCheckedAt) return null;
    restricted = data.restricted;
    lastCheckedAt = data.lastCheckedAt;
  } catch {
    // Never let this section break Home.
    return null;
  }
  if (restricted.length === 0) return null;

  const everywhere = restricted.filter((t) => t.available_count === 0);
  const some = restricted.filter((t) => t.available_count > 0);
  const countries = tallyMarkets(some).length;
  const summary = [
    `${restricted.length} ${restricted.length === 1 ? "track" : "tracks"}`,
    countries > 0 ? `${countries} ${countries === 1 ? "territory" : "territories"}` : null,
    everywhere.length > 0 ? `${everywhere.length} unavailable everywhere` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CollapsibleSection
      title="Territories"
      storageKey={HOME_DETAILS_STORAGE.spotifyMarketGapsOpen}
      actions={
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--sb-muted)" }}>
          <span className={`h-1.5 w-1.5 rounded-full ${everywhere.length > 0 ? "bg-red-500" : "bg-amber-500"}`} />
          {summary}
        </span>
      }
    >
      <div className="space-y-5">
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Tracks that can&apos;t be played on Spotify in some territories, usually because the release wasn&apos;t
          delivered or licensed there. Hover a territory for the reason.
        </p>
        <MarketCountrySummary tracks={some} />
        <GapGroup title="Unavailable everywhere" hint="not playable in any territory" tracks={everywhere} />
        <GapGroup title="Missing in some territories" hint="most territories missing first" tracks={some} />
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs"
          style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
        >
          <span>Checked weekly · last scan {formatScanTime(lastCheckedAt)}</span>
          <Link href="/health#territories" className="hover:underline" style={{ color: "var(--sb-text)" }}>
            Full table on Health →
          </Link>
        </div>
      </div>
    </CollapsibleSection>
  );
}
