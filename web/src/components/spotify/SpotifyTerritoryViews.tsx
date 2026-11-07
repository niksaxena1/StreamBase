"use client";

import { useState } from "react";

import Link from "@/components/shell/RouteLink";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { SpotifyIconLink } from "@/components/spotify/SpotifyIconLink";
import {
  DailyStreamsLabel,
  MarketChip,
  MarketChipList,
  MarketCoverage,
} from "@/components/spotify/SpotifyMarketParts";
import {
  eventVerb,
  formatDailyStreams,
  formatEventDay,
  groupByDistributor,
  groupMarketEvents,
  marketName,
  unusualReasonSummary,
} from "@/lib/health/spotifyMarketFormat";
import type { SpotifyMarketEvent, SpotifyMarketRestrictedTrack } from "@/lib/health/spotifyMarketTypes";

const MAX_CHIPS_IN_GROUP_HEADER = 14;

/** Segmented "By track | By distributor" switch shared by Home and Health. */
export function TerritoryViewToggle({
  byDistributor,
  onChange,
}: {
  byDistributor: boolean;
  onChange: (byDistributor: boolean) => void;
}) {
  return (
    <ChipGroup segmented aria-label="Group territories">
      <Chip segmented selected={!byDistributor} onClick={() => onChange(false)}>
        By track
      </Chip>
      <Chip segmented selected={byDistributor} onClick={() => onChange(true)}>
        By distributor
      </Chip>
    </ChipGroup>
  );
}

/** One restricted track: artwork, Artist – Title, ISRC, missing territories (major first), daily streams, coverage. */
export function TerritoryTrackRow({
  track,
  showDistributor = false,
}: {
  track: SpotifyMarketRestrictedTrack;
  showDistributor?: boolean;
}) {
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
          className="h-10 w-10 flex-shrink-0 rounded object-cover sb-ring"
          label={track.name || track.isrc}
        />
      ) : (
        <div className="h-10 w-10 flex-shrink-0 rounded bg-white/60 sb-ring" />
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
          {showDistributor && track.distributor ? (
            <span className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
              {track.distributor.name}
            </span>
          ) : null}
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
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 md:col-span-1 md:flex-col md:items-end md:justify-center">
        <DailyStreamsLabel value={track.daily_streams} />
        <MarketCoverage available={track.available_count} checked={track.markets_checked} />
      </div>
    </li>
  );
}

/** Rows for a track list, capped with a pointer to Health for the rest. */
export function TerritoryTrackList({
  tracks,
  max = 100,
  showDistributor = false,
}: {
  tracks: SpotifyMarketRestrictedTrack[];
  max?: number;
  showDistributor?: boolean;
}) {
  return (
    <>
      <ul className="divide-y divide-[color:var(--sb-border)]">
        {tracks.slice(0, max).map((t) => (
          <TerritoryTrackRow key={t.isrc} track={t} showDistributor={showDistributor} />
        ))}
      </ul>
      {tracks.length > max ? (
        <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          Showing {max} of {tracks.length}. Filter or export the full list on Health.
        </p>
      ) : null}
    </>
  );
}

/**
 * One expandable card per distributor: "Masafy LANDR · 7 tracks · missing BR IN MX PK", the territory chips
 * being the union over its tracks with a per-territory track count. Biggest combined daily streams first.
 */
export function DistributorGroupsView({ tracks }: { tracks: SpotifyMarketRestrictedTrack[] }) {
  const groups = groupByDistributor(tracks);
  if (groups.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
        No tracks match.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const shown = g.territories.slice(0, MAX_CHIPS_IN_GROUP_HEADER);
        const hidden = g.territories.slice(MAX_CHIPS_IN_GROUP_HEADER);
        return (
          <details key={g.key} className="group rounded-lg border border-[color:var(--sb-border)]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="text-xs opacity-60 transition-transform group-open:rotate-90">▸</span>
              {g.imageUrl ? (
                <PreviewableArtwork
                  src={g.imageUrl}
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 flex-shrink-0 rounded object-cover sb-ring"
                  label={g.name}
                />
              ) : null}
              <span className="text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
                {g.name}
              </span>
              <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                {g.tracks.length} {g.tracks.length === 1 ? "track" : "tracks"}
              </span>
              <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                missing
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                {shown.map(({ code, count }) => (
                  <MarketChip key={code} code={code} count={count} />
                ))}
                {hidden.length > 0 ? (
                  <span
                    className="inline-flex items-center px-1.5 text-xs"
                    style={{ color: "var(--sb-muted)" }}
                    title={hidden.map((h) => `${marketName(h.code)} (${h.count})`).join(", ")}
                  >
                    +{hidden.length} more
                  </span>
                ) : null}
              </span>
              <span className="whitespace-nowrap font-mono text-[11px] tabular-nums" style={{ color: "var(--sb-muted)" }} title="Combined latest daily streams">
                <span style={{ color: "var(--sb-text)" }}>{formatDailyStreams(g.dailyStreams)}</span> / day
              </span>
            </summary>
            <div className="border-t border-[color:var(--sb-border)] px-3">
              <ul className="divide-y divide-[color:var(--sb-border)]">
                {g.tracks.map((t) => (
                  <TerritoryTrackRow key={t.isrc} track={t} />
                ))}
              </ul>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** "07 Nov 2026 · Saxena – Dance Monkey · lost CA" (lost red, regained green), newest first. */
export function RecentChangesList({ events, initialRows = 8 }: { events: SpotifyMarketEvent[]; initialRows?: number }) {
  const [expanded, setExpanded] = useState(false);
  const grouped = groupMarketEvents(events);
  if (grouped.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
        No territory changes in the last 30 days.
      </p>
    );
  }
  const rows = expanded ? grouped : grouped.slice(0, initialRows);
  return (
    <div>
      <ul className="divide-y divide-[color:var(--sb-border)] rounded-lg border border-[color:var(--sb-border)]">
        {rows.map((g) => {
          const lost = g.event === "lost";
          const who = g.artist_names && g.artist_names.length > 0 ? `${g.artist_names.join(", ")} – ` : "";
          return (
            <li key={`${g.day}-${g.isrc}-${g.event}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-xs">
              <span className="whitespace-nowrap font-mono tabular-nums" style={{ color: "var(--sb-muted)" }}>
                {formatEventDay(g.day)}
              </span>
              <span style={{ color: "var(--sb-muted)" }}>·</span>
              <span className="min-w-0">
                <span style={{ color: "var(--sb-muted)" }}>{who}</span>
                <Link href={`/tracks/${g.isrc}`} className="font-medium hover:underline" style={{ color: "var(--sb-text)" }}>
                  {g.name || g.isrc}
                </Link>
              </span>
              <span style={{ color: "var(--sb-muted)" }}>·</span>
              <span
                className={lost ? "font-medium text-red-700 dark:text-red-300" : "font-medium text-emerald-700 dark:text-emerald-300"}
                title={g.markets.map(marketName).join(", ")}
              >
                {eventVerb(g.event)} <span className="font-mono">{g.markets.join(" ")}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {grouped.length > initialRows ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs hover:underline"
          style={{ color: "var(--sb-muted)" }}
        >
          {expanded ? "Show fewer" : `Show all ${grouped.length}`}
        </button>
      ) : null}
    </div>
  );
}
