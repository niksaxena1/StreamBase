import { cx } from "@/lib/cx";
import { marketName, marketReasonLabel, tallyMarkets } from "@/lib/health/spotifyMarketFormat";

/**
 * Shared, server- and client-safe pieces for the per-market Spotify availability UI
 * (Home gaps section, Health table, Catalog badge). No data fetching here.
 */

/** Small country flag image (flagcdn.com, as in Ledgenta's payees page); hidden if it fails to load. */
export function TerritoryFlag({ code, size = 16 }: { code: string; size?: 16 | 20 | 28 }) {
  const width = size === 28 ? 40 : 20;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size external flag
    <img
      src={`https://flagcdn.com/w${width}/${code.toLowerCase()}.png`}
      srcSet={`https://flagcdn.com/w${width * 2}/${code.toLowerCase()}.png 2x`}
      alt=""
      width={size}
      height={Math.round(size * 0.7)}
      loading="lazy"
      className="flex-shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
      style={{ width: size, height: Math.round(size * 0.7) }}
    />
  );
}

/** One missing territory: flag + full name, reason on hover. */
export function MarketChip({ code, reason, count }: { code: string; reason?: string | null; count?: number }) {
  const name = marketName(code);
  const title = count != null ? `${name}: ${count} ${count === 1 ? "track" : "tracks"} unavailable` : `${name}: ${marketReasonLabel(reason)}`;
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 py-0.5 pl-1.5 pr-2 text-xs text-red-800 dark:border-red-400/25 dark:bg-red-500/15 dark:text-red-200"
    >
      <TerritoryFlag code={code} />
      <span className="font-mono text-[11px] font-semibold tracking-wide">{code}</span>
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
    <div className={cx("w-36 flex-shrink-0", className)} title={`Playable on Spotify in ${available} of ${checked} territories`}>
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
        Territories with gaps <span className="normal-case tracking-normal opacity-70">· tracks blocked per territory</span>
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
