import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  cachedSpotifyMarketAvailability,
  type SpotifyMarketEvent,
  type SpotifyMarketRestrictedTrack,
} from "@/lib/health/spotifyMarketAvailability";
import { tallyMarkets } from "@/lib/health/spotifyMarketFormat";
import { HomeTerritoriesBody } from "./HomeTerritoriesBody";
import { HOME_DETAILS_STORAGE } from "./homeUtils";

/**
 * Own-catalog Home: collapsed list of tracks with territory gaps from the daily scan.
 * Loaded separately (cached loader, inside Suspense) so it never touches the home snapshot path.
 * Renders nothing before the first scan or when no track is restricted.
 */
export async function HomeSpotifyMarketGaps() {
  let restricted: SpotifyMarketRestrictedTrack[] = [];
  let events: SpotifyMarketEvent[] = [];
  let lastCheckedAt: string | null = null;
  try {
    const { data } = await cachedSpotifyMarketAvailability();
    if (!data || !data.lastCheckedAt) return null;
    restricted = data.restricted;
    events = data.events;
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
      <HomeTerritoriesBody restricted={restricted} events={events} lastCheckedAt={lastCheckedAt} />
    </CollapsibleSection>
  );
}
