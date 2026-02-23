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
}: {
  runDate: string | null;
  dataDate: string | null;
  playlistMeta: Record<string, PlaylistMeta>;
}) {
  if (!runDate) return null;

  const displayed = await fetchDisplayedWarnings(runDate, playlistMeta);

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
        {displayed.map((w, i) => (
          <WarningRow
            key={`${w.code}-${w.playlist_key ?? "global"}-${i}`}
            warning={w}
            playlistMeta={w.playlistMeta}
            expandedData={w.expandedData}
            allPlaylistMeta={playlistMeta}
            dataDate={dataDate}
          />
        ))}
        {!displayed.length && (
          <EmptyState
            colSpan={4}
            message="No warnings found for the selected filters."
          />
        )}
      </GlassTable>
    </div>
  );
}
