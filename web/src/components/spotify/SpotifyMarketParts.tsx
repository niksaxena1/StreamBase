import { cx } from "@/lib/cx";
import { marketName, marketReasonLabel, tallyMarkets } from "@/lib/health/spotifyMarketFormat";

/**
 * Shared, server- and client-safe pieces for the per-market Spotify availability UI
 * (Home gaps section, Health table, Catalog badge). No data fetching here.
 */

/** One missing country: code + full name, reason on hover. */
export function MarketChip({ code, reason, count }: { code: string; reason?: string | null; count?: number }) {
  const name = marketName(code);
  const title = count != null ? `${name}: ${count} ${count === 1 ? "track" : "tracks"} unavailable` : `${name}: ${marketReasonLabel(reason)}`;
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 py-0.5 pl-1.5 pr-2 text-xs text-red-800 dark:border-red-400/25 dark:bg-red-500/15 dark:text-red-200"
    >
      <span className="font-mono text-[10px] font-semibold tracking-wide opacity-70">{code}</span>
      <span className="whitespace-nowrap">{name}</span>
      {count != null ? (
        <span className="ml-0.5 rounded bg-red-500/20 px-1 font-mono text-[10px] font-semibold tabular-nums dark:bg-red-400/25">
          {count}
        </span>
      ) : null}
    </span>
  );
}

/** Missing countries for one track, capped with a "+N more" that lists the rest on hover. */
export function MarketChipList({
  markets,
  reasons,
  max = 8,
  className,
}: {
  markets: string[];
  reasons?: Record<string, string>;
  max?: number;
  className?: string;
}) {
  const shown = markets.slice(0, max);
  const hidden = markets.slice(max);
  return (
    <div className={cx("flex flex-wrap gap-1", className)}>
      {shown.map((code) => (
        <MarketChip key={code} code={code} reason={reasons?.[code]} />
      ))}
      {hidden.length > 0 ? (
        <span
          title={hidden.map(marketName).join(", ")}
          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs"
          style={{ color: "var(--sb-muted)" }}
        >
          +{hidden.length} more
        </span>
      ) : null}
    </div>
  );
}

/** "Live in 179 of 183" with a thin bar; red when unavailable everywhere. */
export function MarketCoverage({
  available,
  checked,
  className,
}: {
  available: number;
  checked: number;
  className?: string;
}) {
  const pct = checked > 0 ? Math.max(0, Math.min(100, (available / checked) * 100)) : 0;
  const none = available === 0;
  return (
    <div className={cx("w-36 flex-shrink-0", className)} title={`Playable in ${available} of ${checked} Spotify markets`}>
      <div className="flex items-baseline justify-between text-[11px]" style={{ color: "var(--sb-muted)" }}>
        <span>{none ? "Unavailable everywhere" : "Live in"}</span>
        <span className="font-mono tabular-nums">
          <span className={none ? "text-red-600 dark:text-red-400" : ""} style={none ? undefined : { color: "var(--sb-text)" }}>
            {available}
          </span>
          /{checked}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-red-500/25 dark:bg-red-500/30">
        <div className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** "Countries with gaps": each missing country with how many tracks it blocks. */
export function MarketCountrySummary({
  tracks,
  max = 12,
}: {
  tracks: { unavailable_markets: string[] }[];
  max?: number;
}) {
  const tally = tallyMarkets(tracks);
  if (tally.length === 0) return null;
  const shown = tally.slice(0, max);
  const hidden = tally.slice(max);
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
        Countries with gaps <span className="normal-case tracking-normal opacity-70">· tracks blocked per country</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map(({ code, count }) => (
          <MarketChip key={code} code={code} count={count} />
        ))}
        {hidden.length > 0 ? (
          <span
            title={hidden.map((h) => `${marketName(h.code)} (${h.count})`).join(", ")}
            className="inline-flex items-center px-1.5 text-xs"
            style={{ color: "var(--sb-muted)" }}
          >
            +{hidden.length} more
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Catalog selected-track badge: green "All 183 Spotify markets" or red "Not on Spotify in …". */
export function SpotifyMarketsBadge({
  markets,
}: {
  markets: { markets_checked: number; available_count: number; unavailable_markets: string[] };
}) {
  const missing = markets.unavailable_markets;
  if (missing.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-200"
        title="Weekly Spotify market scan"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live in all {markets.markets_checked} Spotify markets
      </span>
    );
  }
  const everywhere = markets.available_count === 0;
  const names = missing.map(marketName);
  const label = everywhere
    ? "Unavailable in every Spotify market"
    : `Not on Spotify in ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` +${names.length - 4} more` : ""}`;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-800 dark:text-red-200"
      title={`${names.join(", ")} (live in ${markets.available_count} of ${markets.markets_checked} markets)`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      {label}
      <span className="font-mono tabular-nums opacity-70">
        {markets.available_count}/{markets.markets_checked}
      </span>
    </span>
  );
}
