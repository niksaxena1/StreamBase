import { MarketChipList } from "@/components/spotify/SpotifyMarketParts";
import {
  buildTerritoryTimeline,
  formatEventDay,
  formatScanTime,
  marketName,
  timelineLabel,
  type TerritoryTimelineEntry,
} from "@/lib/health/spotifyMarketFormat";
import type { SpotifyTrackMarkets } from "@/lib/health/spotifyMarketTypes";

const KIND_CLASS: Record<TerritoryTimelineEntry["kind"], string> = {
  lost: "font-medium text-red-700 dark:text-red-300",
  taken_down: "font-medium text-red-700 dark:text-red-300",
  gained: "font-medium text-emerald-700 dark:text-emerald-300",
  restored: "font-medium text-emerald-700 dark:text-emerald-300",
};

/**
 * Track page "Territories" card (own catalog only): current status (live everywhere, or the missing
 * territories with flags) and a newest-first timeline of territory changes and takedown transitions.
 * Pure presentation of data the page already loaded (cachedSpotifyMarketsForIsrc).
 */
export function SpotifyTerritoryCard({ markets }: { markets: SpotifyTrackMarkets }) {
  const scanned = markets.scanned !== false;
  const missing = markets.unavailable_markets;
  const timeline = buildTerritoryTimeline(markets.history ?? [], markets.takedown_events ?? []);

  return (
    <section className="sb-ring rounded-2xl bg-white/70 p-4 dark:bg-white/5" aria-label="Territories">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Territories</h2>
        {markets.last_checked_at ? (
          <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Last scan {formatScanTime(markets.last_checked_at)}
          </span>
        ) : null}
      </div>

      <div className="mb-3">
        {!scanned ? (
          <span className="text-sm" style={{ color: "var(--sb-muted)" }}>
            Not checked yet
          </span>
        ) : missing.length === 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-800 dark:text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live in all {markets.markets_checked}
          </span>
        ) : (
          <div className="space-y-1.5">
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {markets.available_count === 0
                ? "Not playable in any territory"
                : `Live in ${markets.available_count} of ${markets.markets_checked} · missing in ${missing.length}`}
            </div>
            {markets.available_count > 0 ? (
              <MarketChipList markets={missing} reasons={markets.unavailable_reasons} max={16} />
            ) : null}
          </div>
        )}
      </div>

      {timeline.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          No territory changes recorded for this track.
        </p>
      ) : (
        <ul className="max-h-60 divide-y divide-[color:var(--sb-border)] overflow-y-auto rounded-lg border border-[color:var(--sb-border)]">
          {timeline.map((entry, i) => (
            <li key={`${entry.day}-${entry.kind}-${i}`} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-xs">
              <span className="whitespace-nowrap font-mono tabular-nums" style={{ color: "var(--sb-muted)" }}>
                {formatEventDay(entry.day)}
              </span>
              <span style={{ color: "var(--sb-muted)" }}>·</span>
              <span className={KIND_CLASS[entry.kind]} title={entry.markets.map(marketName).join(", ") || undefined}>
                {timelineLabel(entry)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
