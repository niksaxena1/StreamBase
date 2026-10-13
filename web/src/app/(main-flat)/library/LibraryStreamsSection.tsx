"use client";

import { ExternalLink } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatReleaseDate } from "@/lib/library/format";
import {
  STREAM_RANGES,
  dailyFromCumulative,
  formatCompactStreams,
  formatExactStreams,
  type StreamRange,
} from "@/lib/library/streams";
import type { LibraryRow, LibraryStreamPoint } from "@/lib/library/types";

import { Section } from "./LibraryDetailSections";
import { fetchLibraryStreamSeries } from "./library.actions";

// Same lazy import the catalog page uses, so the chart library stays out of the page chunk.
const DailyStreamsChart = dynamic(() => import("@/components/charts/DailyStreamsChart").then((mod) => mod.DailyStreamsChart), {
  loading: () => <Skeleton className="h-[180px] w-full" />,
});

const SPOTIFY_ID = /^[A-Za-z0-9]{10,40}$/;

type Loaded = { key: string; points: LibraryStreamPoint[] | null; error: string | null };

function Figure({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
        {label}
      </div>
      <div className="font-display text-lg font-semibold tabular-nums" title={value == null ? undefined : formatExactStreams(value)}>
        {value == null ? "—" : formatCompactStreams(value)}
      </div>
      {value != null && value >= 1000 ? (
        <div className="text-[11px] tabular-nums" style={{ color: "var(--sb-muted)" }}>
          {formatExactStreams(value)}
        </div>
      ) : null}
    </div>
  );
}

/** Streams for the open release: totals, links out, and a daily chart loaded on demand. */
export function LibraryStreamsSection({ row, asOf }: { row: LibraryRow; asOf: string | null }) {
  const [range, setRange] = useState<StreamRange>(90);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);

  const catalogId = row.catalog_id;
  const hasIsrc = Boolean(row.isrc);
  const key = `${catalogId}:${range}`;

  useEffect(() => {
    if (!hasIsrc) return;
    let cancelled = false;
    fetchLibraryStreamSeries(catalogId, range)
      .then((res) => {
        if (cancelled) return;
        setLoaded(res.ok ? { key, points: res.points, error: null } : { key, points: null, error: res.error });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ key, points: null, error: e instanceof Error ? e.message : "Couldn't load the chart" });
      });
    return () => {
      cancelled = true;
    };
  }, [catalogId, range, hasIsrc, key, retry]);

  const current = loaded?.key === key ? loaded : null;
  const daily = useMemo(() => (current?.points ? dailyFromCumulative(current.points) : []), [current]);
  const dailyNewestFirst = useMemo(() => [...daily].reverse(), [daily]);

  const spotifyId = row.spotify_track_id && SPOTIFY_ID.test(row.spotify_track_id) ? row.spotify_track_id : null;

  if (!hasIsrc && !spotifyId && row.total_streams == null) return null;

  return (
    <Section
      title="Streams"
      aside={
        <span className="flex items-center gap-1.5">
          {spotifyId ? (
            <Button asChild size="xs" variant="secondary" rightIcon={<ExternalLink className="h-3 w-3" />}>
              <a href={`https://open.spotify.com/track/${spotifyId}`} target="_blank" rel="noopener noreferrer">
                Open in Spotify
              </a>
            </Button>
          ) : null}
          {row.isrc ? (
            <Button asChild size="xs" variant="secondary">
              <Link href={`/tracks/${encodeURIComponent(row.isrc)}`}>Track page</Link>
            </Button>
          ) : null}
        </span>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <Figure label="Total" value={row.total_streams} />
          <Figure label="Last 7 days" value={row.streams_7d} />
        </div>
        <p className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
          {asOf ? `Data as of ${formatReleaseDate(asOf)}.` : "Stream figures aren't available right now."}
        </p>

        {hasIsrc ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
                Daily streams
              </span>
              <ChipGroup segmented aria-label="Chart range">
                {STREAM_RANGES.map((d) => (
                  <Chip key={d} segmented selected={range === d} onClick={() => setRange(d)}>
                    {d} days
                  </Chip>
                ))}
              </ChipGroup>
            </div>
            {current?.error ? (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--sb-error)" }} role="alert">
                {current.error}
                <Button size="xs" variant="secondary" onClick={() => setRetry((n) => n + 1)}>
                  Retry
                </Button>
              </div>
            ) : !current ? (
              <Skeleton className="h-[180px] w-full" />
            ) : daily.length === 0 ? (
              <p className="py-6 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
                No stream data for this range.
              </p>
            ) : (
              <>
                {/* DailyStreamsChart expects newest-first data (like every other caller) and reverses it. */}
                <DailyStreamsChart data={dailyNewestFirst} valueLabel="Streams" heightPx={180} />
                {daily.some((p) => p.estimated) ? (
                  <p className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
                    Some days have no data; the increase between the days either side is spread evenly across them.
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
