import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { formatInt } from "@/lib/format";
import { loadUploadTracksPage } from "@/lib/playlistWatch/loadUploadTracksPage";
import { UploadTracksClient } from "./UploadTracksClient";
import { parseMetric, parseTrackFilter, parseWindow } from "./uploadTracksModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Upload tracks",
};

type SearchParams = { window?: string; metric?: string; filter?: string };

export default async function UploadTracksPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const { playlist, rows, latestSnapshotDate, chartPositions, candidates, charts } = await loadUploadTracksPage();
  const current = rows.filter((r) => !r.removedDate).length;
  const trackCount = rows.length > 0 ? current : (playlist?.trackCount ?? 0);

  const subtitleParts = [
    `${formatInt(trackCount)} tracks`,
    latestSnapshotDate ? `latest snapshot ${latestSnapshotDate}` : "no snapshot yet",
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/playlist-watch"
        className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
        style={{ color: "var(--sb-muted)" }}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Playlist Watch
      </Link>
      <PageHeader
        title={playlist?.displayName ?? "Upload tracks"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <span>{subtitleParts.join(" · ")}</span>
            {playlist ? (
              <a
                href={`https://open.spotify.com/playlist/${playlist.spotifyPlaylistId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                Open in Spotify <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
            {charts.map((ch) =>
              ch.url ? (
                <a key={ch.chartKey} href={ch.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  {ch.name} on Beatport <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null,
            )}
            <Link href="/charts" className="hover:underline">
              Charts page
            </Link>
          </span>
        }
      />
      <UploadTracksClient
        rows={rows}
        chartPositions={chartPositions}
        candidates={candidates}
        charts={charts}
        initialFilter={parseTrackFilter(sp.filter)}
        today={new Date().toISOString().slice(0, 10)}
        initialWindow={parseWindow(sp.window)}
        initialMetric={parseMetric(sp.metric)}
      />
    </div>
  );
}
