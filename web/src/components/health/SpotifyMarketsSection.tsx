import Link from "@/components/shell/RouteLink";
import { cachedSpotifyMarketAvailability } from "@/lib/health/spotifyMarketAvailability";
import {
  formatCoverageLine,
  formatScanTime,
  scanStaleness,
  uncheckedReasonLabel,
} from "@/lib/health/spotifyMarketFormat";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SpotifyMarketsTable } from "./SpotifyMarketsTable";

/**
 * Own-catalog tracks the daily territory scan
 * (scripts/scan_spotify_market_availability.py) finds unplayable in at least
 * one Spotify territory. Hidden until the scan has run at least once.
 * Data is loaded here on the server; filtering, grouping and CSV export live in the client table.
 * The header shows the last successful scan (red once it is over 36 hours old) and how much of the
 * catalog the scan covers, with the tracks it is not checking and why.
 */
export async function SpotifyMarketsSection() {
  const { data } = await cachedSpotifyMarketAvailability();
  if (!data || !data.lastCheckedAt) return null;

  const tracks = data.restricted;
  const coverage = data.coverage;
  const staleness = scanStaleness(data.lastCheckedAt);

  return (
    <div className="space-y-3" id="territories">
      <SectionHeader
        title="Territories"
        subtitle={
          <>
            Territories where a track can&apos;t be played on Spotify. Checked daily ·{" "}
            {staleness.stale ? (
              <span className="font-medium text-red-700 dark:text-red-300">
                Last successful scan: {formatScanTime(data.lastCheckedAt)}
              </span>
            ) : (
              <>Last successful scan: {formatScanTime(data.lastCheckedAt)}</>
            )}
            {data.marketsChecked ? ` · ${data.marketsChecked} territories` : ""}
            {coverage ? ` · ${formatCoverageLine(coverage.checked, coverage.catalogTotal)}` : ""}
          </>
        }
        actions={
          <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"} with gaps
          </span>
        }
      />
      {staleness.message ? (
        <p className="px-1 text-xs font-medium text-red-700 dark:text-red-300" role="alert">
          {staleness.message}
        </p>
      ) : null}
      {coverage && coverage.uncheckedTotal > 0 ? (
        <CollapsibleSection
          title={`${coverage.uncheckedTotal.toLocaleString("en-US")} catalog ${coverage.uncheckedTotal === 1 ? "track" : "tracks"} not checked`}
          subtitle="Taken down tracks are skipped until the takedown watch sees them back"
          storageKey="sb:health:territories:unchecked"
        >
          <ul className="mt-2 max-h-72 divide-y divide-[color:var(--sb-border)] overflow-y-auto rounded-lg border border-[color:var(--sb-border)]">
            {coverage.unchecked.map((t) => (
              <li key={t.isrc} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs">
                <span className="min-w-0">
                  <Link href={`/tracks/${t.isrc}`} className="font-medium hover:underline" style={{ color: "var(--sb-text)" }}>
                    {t.artist_names?.length ? `${t.artist_names.join(", ")} – ` : ""}
                    {t.name || t.isrc}
                  </Link>{" "}
                  <span className="font-mono text-[10px]" style={{ color: "var(--sb-muted)" }}>
                    ({t.isrc})
                  </span>
                </span>
                <span style={{ color: "var(--sb-muted)" }}>{uncheckedReasonLabel(t.reason)}</span>
              </li>
            ))}
          </ul>
          {coverage.uncheckedTotal > coverage.unchecked.length ? (
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--sb-muted)" }}>
              Showing the first {coverage.unchecked.length.toLocaleString("en-US")} of{" "}
              {coverage.uncheckedTotal.toLocaleString("en-US")}.
            </p>
          ) : null}
        </CollapsibleSection>
      ) : null}
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
