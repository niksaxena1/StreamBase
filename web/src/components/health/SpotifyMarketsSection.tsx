import { cachedSpotifyMarketAvailability } from "@/lib/health/spotifyMarketAvailability";
import { formatScanTime } from "@/lib/health/spotifyMarketFormat";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SpotifyMarketsTable } from "./SpotifyMarketsTable";

/**
 * Own-catalog tracks the daily territory scan
 * (scripts/scan_spotify_market_availability.py) finds unplayable in at least
 * one Spotify territory. Hidden until the scan has run at least once.
 * Data is loaded here on the server; filtering, grouping and CSV export live in the client table.
 */
export async function SpotifyMarketsSection() {
  const { data } = await cachedSpotifyMarketAvailability();
  if (!data || !data.lastCheckedAt) return null;

  const tracks = data.restricted;

  return (
    <div className="space-y-3" id="territories">
      <SectionHeader
        title="Territories"
        subtitle={`Territories where a track can't be played on Spotify. Checked daily · last scan ${formatScanTime(data.lastCheckedAt)}${
          data.marketsChecked ? ` · ${data.marketsChecked} territories` : ""
        }`}
        actions={
          <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"} with gaps
          </span>
        }
      />
      {tracks.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          Every checked track plays in every territory.
        </p>
      ) : (
        <SpotifyMarketsTable tracks={tracks} events={data.events} />
      )}
    </div>
  );
}
