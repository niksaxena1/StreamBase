"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { TerritoryFlag } from "@/components/spotify/SpotifyMarketParts";
import {
  eventVerb,
  formatEventDay,
  formatScanTime,
  groupMarketEvents,
  marketName,
  marketReasonLabel,
} from "@/lib/health/spotifyMarketFormat";
import type { SpotifyTrackMarkets } from "@/lib/health/spotifyMarketTypes";

// The world map (d3-geo + atlas) is only needed when the modal opens, so keep it out of the Catalog bundle.
const SpotifyMarketsMap = dynamic(() => import("@/components/spotify/SpotifyMarketsMap").then((m) => m.SpotifyMarketsMap), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-lg bg-black/5 dark:bg-white/10" aria-hidden="true" />,
});

type TrackMarkets = SpotifyTrackMarkets;

/**
 * Catalog selected-track badge: green "Live in all 183 territories", or a red pill that
 * opens a modal listing every territory the track is not available in, with flags.
 */
export function SpotifyMarketsBadge({ markets, trackLabel }: { markets: TrackMarkets; trackLabel?: string | null }) {
  const [open, setOpen] = useState(false);
  const missing = markets.unavailable_markets;

  if (missing.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-800 dark:text-emerald-200"
        title="Daily Spotify territory scan"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Live in all {markets.markets_checked} territories
      </span>
    );
  }

  const everywhere = markets.available_count === 0;
  const sorted = [...missing].sort((a, b) => marketName(a).localeCompare(marketName(b)));
  const names = missing.map(marketName);
  const label = everywhere
    ? "Unavailable in every territory"
    : `Not on Spotify in ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ` +${missing.length - 6}` : ""}`;
  const reasons = markets.unavailable_reasons ?? {};
  const distinctReasons = new Set(sorted.map((c) => reasons[c] ?? "none"));
  const showReasonColumn = distinctReasons.size > 1 || !distinctReasons.has("market");
  const sharedReason = !showReasonColumn ? marketReasonLabel("market") : null;
  const history = groupMarketEvents(
    (markets.history ?? []).map((e) => ({ ...e, isrc: "", name: null, artist_names: null })),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${names.join(", ")}: click for details`}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-800 transition hover:border-red-500/50 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 dark:text-red-200"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        {label}
        <span className="font-mono tabular-nums opacity-70">
          {markets.available_count}/{markets.markets_checked}
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidthClassName="max-w-lg"
        title={`Not available in ${missing.length} ${missing.length === 1 ? "territory" : "territories"}`}
        subtitle={
          <span>
            {trackLabel ? <>{trackLabel} · </> : null}
            Live in {markets.available_count} of {markets.markets_checked} territories
            {markets.last_checked_at ? <> · last scan {formatScanTime(markets.last_checked_at)}</> : null}
          </span>
        }
      >
        <div className="space-y-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-red-500/25 dark:bg-red-500/30">
            <div
              className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
              style={{ width: `${markets.markets_checked > 0 ? (markets.available_count / markets.markets_checked) * 100 : 0}%` }}
            />
          </div>
          <SpotifyMarketsMap missing={missing} />
          {everywhere ? (
            <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
              Spotify reports this track as not playable in any territory.
            </p>
          ) : null}
          <ul className="max-h-[60vh] divide-y divide-[color:var(--sb-border)] overflow-y-auto rounded-lg border border-[color:var(--sb-border)]">
            {sorted.map((code) => (
              <li key={code} className="flex items-center gap-3 px-3 py-2">
                <TerritoryFlag code={code} size={28} />
                <span className="flex-1 text-sm" style={{ color: "var(--sb-text)" }}>
                  {marketName(code)}
                </span>
                {showReasonColumn ? (
                  <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                    {marketReasonLabel(reasons[code])}
                  </span>
                ) : null}
                <span className="w-7 text-right font-mono text-[11px]" style={{ color: "var(--sb-muted)" }}>
                  {code}
                </span>
              </li>
            ))}
          </ul>
          {history.length > 0 ? (
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
                History
              </div>
              <ul className="max-h-40 divide-y divide-[color:var(--sb-border)] overflow-y-auto rounded-lg border border-[color:var(--sb-border)]">
                {history.map((g) => (
                  <li key={`${g.day}-${g.event}`} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5 text-xs">
                    <span className="whitespace-nowrap font-mono tabular-nums" style={{ color: "var(--sb-muted)" }}>
                      {formatEventDay(g.day)}
                    </span>
                    <span style={{ color: "var(--sb-muted)" }}>·</span>
                    <span
                      className={g.event === "lost" ? "font-medium text-red-700 dark:text-red-300" : "font-medium text-emerald-700 dark:text-emerald-300"}
                      title={g.markets.map(marketName).join(", ")}
                    >
                      {eventVerb(g.event)} <span className="font-mono">{g.markets.join(" ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {sharedReason ? (
            <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Spotify&apos;s reason for all: <code className="font-mono">market</code> ({sharedReason.toLowerCase()}). This
              usually comes from the release&apos;s territory settings at the distributor.
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
