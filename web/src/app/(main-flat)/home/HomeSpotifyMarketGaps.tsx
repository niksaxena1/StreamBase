import Link from "@/components/shell/RouteLink";

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import {
  cachedSpotifyMarketAvailability,
  type SpotifyMarketRestrictedTrack,
} from "@/lib/health/spotifyMarketAvailability";
import { formatMarketCount, marketName, truncateMarkets } from "@/lib/health/spotifyMarketFormat";
import { HOME_DETAILS_STORAGE } from "./homeUtils";

const MAX_ROWS_PER_GROUP = 100;

function GapRow({ track }: { track: SpotifyMarketRestrictedTrack }) {
  const { shown, more } = truncateMarkets(track.unavailable_markets, 12);
  const hiddenNames = track.unavailable_markets.slice(shown.length).map(marketName).join(", ");
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
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
      <div className="min-w-[12rem] flex-1">
        <div className="text-sm flex flex-wrap items-baseline gap-x-1">
          {track.artist_names && track.artist_names.length > 0 ? (
            <>
              <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
              <span className="opacity-50">–</span>
            </>
          ) : null}
          <Link href={`/tracks/${track.isrc}`} className="font-medium hover:underline" style={{ color: "var(--sb-text)" }}>
            {track.name || track.isrc}
          </Link>
        </div>
        <div className="mt-0.5">
          <CopyableIsrc
            isrc={track.isrc}
            className="font-mono text-[10px] text-lime-600 underline hover:opacity-80 dark:text-lime-400"
          />
        </div>
      </div>
      <span className="font-mono text-xs opacity-70">{formatMarketCount(track.available_count, track.markets_checked)}</span>
      <div className="flex flex-wrap gap-1">
        {shown.map((code) => (
          <span
            key={code}
            title={marketName(code)}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-mono bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300"
          >
            {code}
          </span>
        ))}
        {more > 0 ? (
          <span title={hiddenNames} className="inline-flex items-center px-1 py-0.5 text-xs opacity-60">
            +{more} more
          </span>
        ) : null}
      </div>
    </li>
  );
}

function GapGroup({ title, tracks }: { title: string; tracks: SpotifyMarketRestrictedTrack[] }) {
  if (tracks.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
        {title} <span className="opacity-60">({tracks.length})</span>
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--sb-border)" }}>
        {tracks.slice(0, MAX_ROWS_PER_GROUP).map((t) => (
          <GapRow key={t.isrc} track={t} />
        ))}
      </ul>
      {tracks.length > MAX_ROWS_PER_GROUP ? (
        <p className="mt-1 text-xs opacity-60">Showing {MAX_ROWS_PER_GROUP} of {tracks.length}.</p>
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
  try {
    const { data } = await cachedSpotifyMarketAvailability();
    if (!data || !data.lastCheckedAt) return null;
    restricted = data.restricted;
  } catch {
    // Never let this section break Home.
    return null;
  }
  if (restricted.length === 0) return null;

  const everywhere = restricted.filter((t) => t.available_count === 0);
  const some = restricted.filter((t) => t.available_count > 0);
  const chip = `${restricted.length} ${restricted.length === 1 ? "track" : "tracks"}${
    everywhere.length > 0 ? ` · ${everywhere.length} unavailable everywhere` : ""
  }`;

  return (
    <CollapsibleSection
      title="Spotify market gaps"
      storageKey={HOME_DETAILS_STORAGE.spotifyMarketGapsOpen}
      actions={<span className="text-xs opacity-60">{chip}</span>}
    >
      <div className="space-y-4">
        <GapGroup title="Unavailable everywhere" tracks={everywhere} />
        <GapGroup title="Unavailable in some markets" tracks={some} />
        <div className="text-xs">
          <Link href="/health#spotify-markets" className="underline opacity-70 hover:opacity-100">
            View on Health
          </Link>
        </div>
      </div>
    </CollapsibleSection>
  );
}
