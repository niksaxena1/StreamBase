import Link from "next/link";
import { cachedDisplayedWarnings } from "@/lib/health/cachedHealthQueries";
import type { WarningAuditView } from "@/lib/health/fetchWarningDetails";
import type { PlaylistMeta } from "@/lib/health/types";
import { GlassTable, EmptyState } from "@/components/ui/GlassTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { WarningRow } from "@/components/health/WarningRow";

const PROVIDER_LABELS: Record<string, string> = {
  music_analytics: "MusicAnalytics",
  checkleakedcc: "CheckLeakedCC",
  beat_analytics: "Beat Analytics",
  music_metrics: "Music Metrics",
};

const PROVIDER_URLS: Record<string, string> = {
  music_analytics: "https://rapidapi.com/MusicAnalyticsApi/api/spotify-stream-count",
  checkleakedcc: "https://rapidapi.com/airaudoeduardo/api/spotify81",
  beat_analytics: "https://rapidapi.com/beat-analytics-beat-analytics-default/api/spotify-statistics-and-stream-count",
  music_metrics: "https://rapidapi.com/music-metrics-music-metrics-default/api/spotify-track-streams-playback-count1",
};

/**
 * Async server component that fetches all warning data (including expanded
 * track details) and renders the warnings table. Designed to be wrapped in a
 * <Suspense> boundary so the page shell renders immediately while this
 * streams in.
 */
export async function WarningsSection({
  runDate,
  dataDate,
  playlistMeta,
  page = 1,
  dateParam,
  view = "active",
}: {
  runDate: string | null;
  dataDate: string | null;
  playlistMeta: Record<string, PlaylistMeta>;
  page?: number;
  dateParam?: string | null;
  view?: WarningAuditView;
}) {
  if (!runDate) return null;

  const { data: warningPayload } = await cachedDisplayedWarnings(runDate, playlistMeta, page, view);
  const { warnings, totalCount, page: safePage, pageSize, totalPages, summary } = warningPayload ?? {
    warnings: [],
    totalCount: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
    summary: { active: 0, resolved: 0, detected: 0 },
  };

  // Build a query-string helper that preserves existing params while changing page.
  function sectionHref(nextView: WarningAuditView, p = 1) {
    const params = new URLSearchParams();
    if (dateParam) params.set("date", dateParam);
    if (nextView !== "active") params.set("view", nextView);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/health?${qs}` : "/health";
  }

  const showPagination = totalCount > pageSize;
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalCount);
  const tabs: Array<{ view: WarningAuditView; label: string; count: number }> = [
    { view: "active", label: "Active", count: summary.active },
    { view: "resolved", label: "Resolved", count: summary.resolved },
    { view: "all", label: "All", count: summary.detected },
  ];

  return (
    <div className="space-y-2">
      <SectionHeader
        title={
          <>
            Warnings{" "}
            {dataDate ? (
              <span className="text-xs font-normal opacity-60">
                (Data: {dataDate}, Run: {runDate})
              </span>
            ) : null}
            {showPagination && (
              <span className="text-xs font-normal opacity-60 ml-2">
                — {start}–{end} of {totalCount}
              </span>
            )}
          </>
        }
        actions={
          <div className="inline-flex items-center rounded-lg bg-white/5 p-0.5 sb-ring">
            {tabs.map((tab) => (
              <Link
                key={tab.view}
                href={sectionHref(tab.view)}
                className={[
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition",
                  view === tab.view
                    ? "bg-[var(--sb-accent)] text-[var(--sb-accent-text,#000)]"
                    : "text-[var(--sb-muted)] hover:bg-white/10 hover:text-[var(--sb-text)]",
                ].join(" ")}
              >
                {tab.label} <span className="tabular-nums opacity-70">{tab.count}</span>
              </Link>
            ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/5 px-3 py-2 text-[11px] opacity-80 sb-ring">
        <span>
          <span className="font-medium text-[var(--sb-text)]">Today&apos;s actions:</span>{" "}
          {(summary.overrideCount ?? 0).toLocaleString()} stream override{(summary.overrideCount ?? 0) === 1 ? "" : "s"} applied
        </span>
        <span className="opacity-35">·</span>
        {(summary.providerCalls ?? []).length > 0 ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {(summary.providerCalls ?? []).map((row, index) => (
              <span key={row.provider} className="inline-flex items-center gap-1">
                {index > 0 ? <span className="opacity-35">·</span> : null}
                <span>{row.calls.toLocaleString()}</span>
                <a
                  href={PROVIDER_URLS[row.provider] ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline decoration-white/20 underline-offset-2 hover:opacity-80"
                >
                  {PROVIDER_LABELS[row.provider] ?? row.provider}
                </a>
                <span>call{row.calls === 1 ? "" : "s"}</span>
              </span>
            ))}
          </span>
        ) : (
          <span>No stream lookup calls recorded</span>
        )}
      </div>
      <GlassTable
        tableLayout="fixed"
        headers={[
          { label: "Severity", className: "w-[74px]" },
          {
            label: "Code",
            className: "hidden xl:table-cell xl:w-[160px]",
          },
          {
            label: "Playlist",
            className: "hidden xl:table-cell xl:w-[190px]",
          },
          { label: "Message" },
        ]}
      >
        {warnings.map((w, i) => (
          <WarningRow
            key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
            warning={w}
            playlistMeta={w.playlistMeta}
            expandedData={w.expandedData}
            allPlaylistMeta={playlistMeta}
            runDate={runDate}
          />
        ))}
        {!warnings.length && (
          <EmptyState
            colSpan={4}
            message="No warnings found for the selected filters."
          />
        )}
      </GlassTable>

      {showPagination && (
        <div className="flex items-center justify-between gap-2 pt-1 text-sm">
          <span className="opacity-50">
            Page {safePage} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            {safePage > 1 ? (
              <Link
                href={sectionHref(view, safePage - 1)}
                className="px-3 py-1 rounded sb-ring bg-white/5 hover:bg-white/10 transition-colors"
              >
                ← Prev
              </Link>
            ) : (
              <span className="px-3 py-1 rounded opacity-30 cursor-not-allowed">
                ← Prev
              </span>
            )}
            {safePage < totalPages ? (
              <Link
                href={sectionHref(view, safePage + 1)}
                className="px-3 py-1 rounded sb-ring bg-white/5 hover:bg-white/10 transition-colors"
              >
                Next →
              </Link>
            ) : (
              <span className="px-3 py-1 rounded opacity-30 cursor-not-allowed">
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
