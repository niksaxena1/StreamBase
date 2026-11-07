"use client";

import Link from "@/components/shell/RouteLink";
import { MarketCountrySummary } from "@/components/spotify/SpotifyMarketParts";
import {
  DistributorGroupsView,
  RecentChangesList,
  TerritoryTrackList,
  TerritoryViewToggle,
} from "@/components/spotify/SpotifyTerritoryViews";
import { formatScanTime } from "@/lib/health/spotifyMarketFormat";
import type { SpotifyMarketEvent, SpotifyMarketRestrictedTrack } from "@/lib/health/spotifyMarketTypes";
import { useStoredBoolState } from "@/lib/useStoredBoolState";
import { HOME_DETAILS_STORAGE } from "./homeUtils";

function GapGroup({ title, hint, tracks }: { title: string; hint: string; tracks: SpotifyMarketRestrictedTrack[] }) {
  if (tracks.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2 border-b border-[color:var(--sb-border)] pb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
          {title}
        </span>
        <span className="rounded-full bg-black/5 px-1.5 font-mono text-[10px] tabular-nums dark:bg-white/10">{tracks.length}</span>
        <span className="text-[11px]" style={{ color: "var(--sb-muted)" }}>{hint}</span>
      </div>
      <TerritoryTrackList tracks={tracks} />
    </div>
  );
}

/**
 * Body of Home's Territories section. Data is fetched on the server (HomeSpotifyMarketGaps) and passed
 * in; this client part only owns the "By track | By distributor" switch (remembered in localStorage).
 */
export function HomeTerritoriesBody({
  restricted,
  events,
  lastCheckedAt,
}: {
  restricted: SpotifyMarketRestrictedTrack[];
  events: SpotifyMarketEvent[];
  lastCheckedAt: string | null;
}) {
  const [byDistributor, setByDistributor] = useStoredBoolState(HOME_DETAILS_STORAGE.spotifyMarketGapsByDistributor, false);
  const everywhere = restricted.filter((t) => t.available_count === 0);
  const some = restricted.filter((t) => t.available_count > 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          Tracks that can&apos;t be played on Spotify in some territories, usually a territory setting at the distributor.
          Biggest tracks (latest daily streams) first; major markets are highlighted. Hover a territory for the reason.
        </p>
        <TerritoryViewToggle byDistributor={byDistributor} onChange={setByDistributor} />
      </div>
      <MarketCountrySummary tracks={some} />
      {byDistributor ? (
        <DistributorGroupsView tracks={restricted} />
      ) : (
        <>
          <GapGroup title="Unavailable everywhere" hint="not playable in any territory" tracks={everywhere} />
          <GapGroup title="Missing in some territories" hint="biggest tracks first" tracks={some} />
        </>
      )}
      {events.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
            Recent changes <span className="normal-case tracking-normal opacity-70">· last 30 days</span>
          </div>
          <RecentChangesList events={events} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--sb-border)] pt-2 text-xs" style={{ color: "var(--sb-muted)" }}>
        <span>Checked daily · last scan {formatScanTime(lastCheckedAt)}</span>
        <Link href="/health#territories" className="hover:underline" style={{ color: "var(--sb-text)" }}>
          Filter and export on Health →
        </Link>
      </div>
    </div>
  );
}
