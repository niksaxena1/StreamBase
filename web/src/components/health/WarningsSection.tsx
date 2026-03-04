import Link from "next/link";
import { fetchDisplayedWarnings } from "@/lib/health/fetchWarningDetails";
import type { PlaylistMeta } from "@/lib/health/types";
import { GlassTable, EmptyState } from "@/components/ui/GlassTable";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { WarningRow } from "@/components/health/WarningRow";

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
}: {
  runDate: string | null;
  dataDate: string | null;
  playlistMeta: Record<string, PlaylistMeta>;
  page?: number;
  dateParam?: string | null;
}) {
  if (!runDate) return null;

  const { warnings, totalCount, page: safePage, pageSize, totalPages } =
    await fetchDisplayedWarnings(runDate, playlistMeta, page);

  // Build a query-string helper that preserves existing params while changing page.
  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (dateParam) params.set("date", dateParam);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/health?${qs}` : "/health";
  }

  const showPagination = totalCount > pageSize;
  const start = (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, totalCount);

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
        actions={undefined}
      />
      <GlassTable
        tableLayout="fixed"
        headers={[
          { label: "Severity", className: "w-[74px]" },
          {
            label: "Code",
            className: "hidden sm:table-cell sm:w-[160px]",
          },
          {
            label: "Playlist",
            className: "hidden sm:table-cell sm:w-[190px]",
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
                href={pageHref(safePage - 1)}
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
                href={pageHref(safePage + 1)}
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
