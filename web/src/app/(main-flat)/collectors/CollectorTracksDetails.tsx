"use client";

import Link from "next/link";
import type { Dispatch, PointerEvent as ReactPointerEvent, ReactNode, RefObject, SetStateAction } from "react";
import { Search, X } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { StatCard } from "@/components/StatCard";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect";
import { Input } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/Button";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

import type { CollectorTrackRow, Metric, SelectedPlaylistMeta, TrackSort } from "./collectorsTypes";
import type { computeTopTrackCards } from "./collectorsUtils";

const SORTS: MenuSelectOption[] = [
  { value: "delta_desc", label: "Daily ↓" },
  { value: "delta_asc", label: "Daily ↑" },
  { value: "total_desc", label: "Total ↓" },
  { value: "total_asc", label: "Total ↑" },
  { value: "release_desc", label: "Release ↓" },
  { value: "release_asc", label: "Release ↑" },
  { value: "name_asc", label: "Name ↑" },
  { value: "name_desc", label: "Name ↓" },
  { value: "distro_desc", label: "Distro ↓" },
  { value: "distro_asc", label: "Distro ↑" },
];

type TrackHeaderButtonArgs = {
  label: string;
  asc: TrackSort;
  desc: TrackSort;
  defaultDir: "asc" | "desc";
  align?: "left" | "right";
  title?: string;
};

/** Selected collector tracks: summary cards, search/sort controls, and table (collapsible). */
export function CollectorTracksDetails({
  openTracks,
  setOpenTracks,
  tracksLoaded,
  tracksLoading,
  tracksError,
  selectedCollector,
  collectorTracks,
  filteredSortedTracks,
  topTrackCards,
  metric,
  payoutPerStreamUsd,
  playlistMetaByKey,
  trackQuery,
  setTrackQuery,
  trackSort,
  setTrackSort,
  trackHeaderButton,
  showIsrcInDistroCol,
  setShowIsrcInDistroCol,
  showIsrcOnMobile,
  lpFiredRef,
  releaseLpDown,
  releaseLpMove,
  releaseLpUp,
  releaseLpCancel,
  tracksTableIsRevenue,
  tracksTableTotalLabel,
  tracksTableDailyLabel,
}: {
  openTracks: boolean;
  setOpenTracks: Dispatch<SetStateAction<boolean>>;
  tracksLoaded: boolean;
  tracksLoading: boolean;
  tracksError: string | null;
  selectedCollector: string;
  collectorTracks: CollectorTrackRow[];
  filteredSortedTracks: CollectorTrackRow[];
  topTrackCards: ReturnType<typeof computeTopTrackCards>;
  metric: Metric;
  payoutPerStreamUsd: number;
  playlistMetaByKey: Map<string, SelectedPlaylistMeta>;
  trackQuery: string;
  setTrackQuery: Dispatch<SetStateAction<string>>;
  trackSort: TrackSort;
  setTrackSort: Dispatch<SetStateAction<TrackSort>>;
  trackHeaderButton: (args: TrackHeaderButtonArgs) => { label: ReactNode; align?: "left" | "right" };
  showIsrcInDistroCol: boolean;
  setShowIsrcInDistroCol: Dispatch<SetStateAction<boolean>>;
  showIsrcOnMobile: boolean;
  lpFiredRef: RefObject<boolean>;
  releaseLpDown: (e: ReactPointerEvent) => void;
  releaseLpMove: (e: ReactPointerEvent) => void;
  releaseLpUp: () => void;
  releaseLpCancel: () => void;
  tracksTableIsRevenue: boolean;
  tracksTableTotalLabel: string;
  tracksTableDailyLabel: string;
}) {
  return (
    <details
      open={openTracks}
      onToggle={(ev) => setOpenTracks(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="flex-shrink-0 text-xs opacity-60 mt-0.5">▸</span>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Tracks
              </div>
              {!openTracks && !tracksLoaded ? (
                <div className="mt-0.5 text-[10px] font-normal normal-case opacity-50">
                  Expand to load the full track list
                </div>
              ) : null}
            </div>
          </div>
          <div
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
            }}
          >
            <ChartCsvDownloadButton
              rows={collectorTracks as unknown as Array<Record<string, unknown>>}
              filename={`collectors-${slugifyForFilename(selectedCollector)}-tracks-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-4">
        <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Cumulative streams are totals from the DB on the data date. &quot;Daily&quot; is today minus yesterday (based on cumulative streams). Revenue is estimated from payout rate.
        </div>
        {/* Quick summary */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <StatCard
          title="Top daily track"
          value={
            topTrackCards.bestDelta?.daily_streams_delta == null
              ? "—"
              : metric === "revenue"
                ? formatUsd2(topTrackCards.bestDelta.daily_streams_delta * payoutPerStreamUsd)
                : `${topTrackCards.bestDelta.daily_streams_delta >= 0 ? "+" : ""}${formatInt(topTrackCards.bestDelta.daily_streams_delta)}`
          }
          subtitle={
            topTrackCards.bestDelta ? (
              <div className="flex items-center gap-2">
                {topTrackCards.bestDelta.album_image_url ? (
                  <PreviewableArtwork
                    src={topTrackCards.bestDelta.album_image_url}
                    alt="Album cover"
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded object-cover"
                    label={topTrackCards.bestDelta.name ?? topTrackCards.bestDelta.isrc}
                  />
                ) : (
                  <div className="h-6 w-6 rounded bg-white/60 dark:bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/tracks/${topTrackCards.bestDelta.isrc}`}
                    className="block truncate transition-colors sb-link-hover font-medium text-xs"
                  >
                    {topTrackCards.bestDelta.name ?? topTrackCards.bestDelta.isrc}
                  </Link>
                  {topTrackCards.bestDelta.artist_names?.length ? (
                    <div className="text-xs opacity-60">
                      <ArtistLinks
                        artistNames={topTrackCards.bestDelta.artist_names}
                        artistIds={topTrackCards.bestDelta.artist_ids}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              "—"
            )
          }
          distroName={
            topTrackCards.bestDelta?.distro_playlist_names?.[0]
          }
          distroImageUrl={
            topTrackCards.bestDelta?.distro_playlist_image_urls?.[0]
          }
        />
        <StatCard
          title="Top total track"
          value={
            topTrackCards.bestTotal?.total_streams_cumulative == null
              ? "—"
              : metric === "revenue"
                ? formatUsd2(topTrackCards.bestTotal.total_streams_cumulative * payoutPerStreamUsd)
                : formatInt(topTrackCards.bestTotal.total_streams_cumulative)
          }
          subtitle={
            topTrackCards.bestTotal ? (
              <div className="flex items-center gap-2">
                {topTrackCards.bestTotal.album_image_url ? (
                  <PreviewableArtwork
                    src={topTrackCards.bestTotal.album_image_url}
                    alt="Album cover"
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded object-cover"
                    label={topTrackCards.bestTotal.name ?? topTrackCards.bestTotal.isrc}
                  />
                ) : (
                  <div className="h-6 w-6 rounded bg-white/60 dark:bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/tracks/${topTrackCards.bestTotal.isrc}`}
                    className="block truncate transition-colors sb-link-hover font-medium text-xs"
                  >
                    {topTrackCards.bestTotal.name ?? topTrackCards.bestTotal.isrc}
                  </Link>
                  {topTrackCards.bestTotal.artist_names?.length ? (
                    <div className="text-xs opacity-60">
                      <ArtistLinks
                        artistNames={topTrackCards.bestTotal.artist_names}
                        artistIds={topTrackCards.bestTotal.artist_ids}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              "—"
            )
          }
          distroName={
            topTrackCards.bestTotal?.distro_playlist_names?.[0]
          }
          distroImageUrl={
            topTrackCards.bestTotal?.distro_playlist_image_urls?.[0]
          }
        />
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "var(--sb-muted)" }}
          />
          <Input
            type="text"
            value={trackQuery}
            onChange={(e) => setTrackQuery(e.target.value)}
            placeholder="Search tracks / artists / ISRC…"
            className="pl-8 pr-8 py-1.5 text-xs"
          />
          {trackQuery && (
            <IconButton
              type="button"
              onClick={() => setTrackQuery("")}
              aria-label="Clear search"
              title="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md"
            >
              <X className="h-3.5 w-3.5" style={{ color: "var(--sb-muted)" }} />
            </IconButton>
          )}
        </div>

        <MenuSelect value={trackSort} options={SORTS} onChange={(v) => setTrackSort(v as TrackSort)} align="right" ariaLabel="Sort tracks" />

        <div className="text-xs whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
          {formatInt(filteredSortedTracks.length)} / {formatInt(collectorTracks.length)}
        </div>
        </div>

        {tracksError ? (
          <div className="mt-3 text-xs text-red-500">{tracksError}</div>
        ) : null}
        {tracksLoading ? (
          <div className="mt-3 text-xs" style={{ color: "var(--sb-muted)" }}>
            Loading tracks…
          </div>
        ) : null}

        <div className="mt-4">
          <GlassTable
            headers={[
              "",
              trackHeaderButton({ label: "TRACK", asc: "name_asc", desc: "name_desc", defaultDir: "asc" }),
              {
                label: (
                  <button
                    type="button"
                    onClick={() => setShowIsrcInDistroCol((v) => !v)}
                    className="flex items-center gap-1 uppercase tracking-wider text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity"
                    title={showIsrcInDistroCol ? "Show distro playlist" : "Show ISRC"}
                  >
                    {showIsrcInDistroCol ? "ISRC" : "DISTRO"}
                    <span className="opacity-50 text-[9px]">⇄</span>
                  </button>
                ),
                className: "hidden sm:table-cell",
              },
              {
                label: (
                  <div
                    onPointerDown={releaseLpDown}
                    onPointerMove={releaseLpMove}
                    onPointerUp={releaseLpUp}
                    onPointerCancel={releaseLpCancel}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (lpFiredRef.current) { lpFiredRef.current = false; return; }
                        setTrackSort(trackSort === "release_asc" ? "release_desc" : "release_asc");
                      }}
                      className="w-full text-left select-none cursor-default uppercase"
                      style={{ color: "inherit" }}
                    >
                      <span className="sm:hidden">{showIsrcOnMobile ? "ISRC" : "RELEASE DATE"}</span>
                      <span className="hidden sm:inline">RELEASE DATE</span>
                    </button>
                  </div>
                ),
              },
              trackHeaderButton({ label: tracksTableTotalLabel.toUpperCase(), asc: "total_asc", desc: "total_desc", defaultDir: "desc", align: "right" }),
              trackHeaderButton({
                label: tracksTableDailyLabel.toUpperCase(),
                asc: "delta_asc",
                desc: "delta_desc",
                defaultDir: "desc",
                align: "right",
                title: "Today minus yesterday (based on cumulative streams). Click to sort.",
              }),
            ]}
            maxBodyHeightClassName="max-h-[520px]"
          >
          {filteredSortedTracks.map((t) => {
            const distroKeys = (t.distro_playlist_keys ?? []).filter(Boolean);
            const distroNames = (t.distro_playlist_names ?? []).filter(Boolean);
            const distroImages = (t.distro_playlist_image_urls ?? []).filter(Boolean);
            const distroTitle = distroNames.length ? distroNames.join(", ") : distroKeys.join(", ");

            return (
              <TableRow key={t.isrc}>
                <TableCell>
                  {t.album_image_url ? (
                    <PreviewableArtwork
                      src={t.album_image_url}
                      alt="Album cover"
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-lg object-cover sb-ring"
                      label={t.name ?? t.isrc}
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10" />
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/tracks/${t.isrc}`}
                    className="font-medium transition-colors sb-link-hover"
                  >
                    {t.name ?? t.isrc}
                  </Link>
                  {t.artist_names?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks
                        artistNames={t.artist_names}
                        artistIds={t.artist_ids}
                      />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {showIsrcInDistroCol ? (
                    <CopyableIsrc
                      isrc={t.isrc}
                      className="font-mono text-xs opacity-40"
                      style={{ color: "var(--sb-muted)" }}
                    />
                  ) : distroNames.length ? (
                    <div className="flex items-center gap-1.5 min-w-0">
                      {distroImages[0] ? (
                        <PreviewableArtwork
                          src={distroImages[0]}
                          alt={distroNames[0]}
                          width={20}
                          height={20}
                          className="h-5 w-5 rounded flex-shrink-0 object-cover"
                          label={distroNames[0]}
                        />
                      ) : (
                        <div className="h-5 w-5 rounded flex-shrink-0 bg-orange-400/20" />
                      )}
                      <span className="truncate text-xs" style={{ color: "var(--sb-muted)" }}>{distroNames[0]}</span>
                    </div>
                  ) : (
                    <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>—</span>
                  )}
                </TableCell>
                <TableCell
                  mono
                  className="whitespace-nowrap text-xs opacity-40"
                  style={{ color: "var(--sb-muted)" }}
                >
                  {showIsrcOnMobile ? (
                    <CopyableIsrc isrc={t.isrc} className="text-xs opacity-100" style={{ color: "var(--sb-muted)" }} />
                  ) : t.release_date ? (
                    formatDateISO(t.release_date)
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
                <TableCell
                  className={tracksTableIsRevenue ? "font-medium" : "sb-positive font-medium"}
                  style={tracksTableIsRevenue ? { color: "#10b981" } : undefined}
                >
                  {t.total_streams_cumulative == null
                    ? "—"
                    : tracksTableIsRevenue
                      ? formatUsd2(t.total_streams_cumulative * payoutPerStreamUsd)
                      : formatInt(t.total_streams_cumulative)}
                </TableCell>
                <TableCell
                  className={
                    t.daily_streams_delta != null && t.daily_streams_delta < 0
                      ? "text-red-600 dark:text-red-400 font-medium"
                      : tracksTableIsRevenue
                        ? "font-medium"
                        : "sb-positive font-medium"
                  }
                  style={
                    tracksTableIsRevenue && !(t.daily_streams_delta != null && t.daily_streams_delta < 0)
                      ? { color: "#10b981" }
                      : undefined
                  }
                >
                  {t.daily_streams_delta == null
                    ? "—"
                    : tracksTableIsRevenue
                      ? formatUsd2(t.daily_streams_delta * payoutPerStreamUsd)
                      : `${formatInt(t.daily_streams_delta)}`}
                </TableCell>
                <TableCell title={distroKeys.length ? distroTitle : undefined}>
                  {distroKeys.length ? (
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex -space-x-1">
                        {distroKeys.slice(0, 4).map((k) => {
                          const meta = playlistMetaByKey.get(String(k));
                          const imgUrl = meta?.spotify_playlist_image_url ?? null;
                          const label = meta?.display_name ?? String(k);
                          return imgUrl ? (
                            <PreviewableArtwork
                              key={k}
                              src={imgUrl}
                              alt={label}
                              width={20}
                              height={20}
                              className="h-5 w-5 rounded-full object-cover sb-ring"
                              label={label}
                            />
                          ) : (
                            <div
                              key={k}
                              className="h-5 w-5 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold"
                              style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
                              title={label}
                            >
                              {label.trim().slice(0, 1).toUpperCase()}
                            </div>
                          );
                        })}
                        {distroKeys.length > 4 ? (
                          <div
                            className="h-5 w-5 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold"
                            style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-text)" }}
                            title={distroTitle}
                          >
                            {distroKeys.length - 4}
                          </div>
                        ) : null}
                      </div>
                      <span className="truncate text-xs opacity-70">
                        {distroNames.length ? distroNames.join(", ") : "Distro"}
                      </span>
                    </div>
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {!filteredSortedTracks.length ? (
            <TableRow>
              <TableCell className="py-8 text-center opacity-50" colSpan={7}>
                No matching tracks.
              </TableCell>
            </TableRow>
          ) : null}
          </GlassTable>
        </div>
      </div>
    </details>
  );
}
