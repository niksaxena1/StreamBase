"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  Search,
  RotateCcw,
  ImageIcon,
  Scaling,
  UserX,
  Table2,
  SquareDashed,
  HelpCircle,
  Download,
  Loader2,
  X,
  Filter,
  Music,
} from "lucide-react";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import { IconButton } from "@/components/ui/Button";
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect";
import type { FilterConfig } from "@/components/filters/filterTypes";
import { hasActiveConditions, networkFilterUsesStreamFields } from "@/components/filters/filterQuery";
import { ToggleButton } from "./NetworkSelectedArtistPanel";
import { SCOPE_CATALOG, SCOPE_CUSTOM } from "./networkGraphConstants";
import { accentRgba } from "./networkGraphPure";
import type { CollabCountBasis, NetworkUrlPatch } from "./networkGraphTypes";
import {
  collabRangeIsActive,
  formatCollabRangeSummary,
  parseTrackCountInputDraft,
} from "./networkGraphUrl";
import {
  DEFAULT_NETWORK_SCOPE,
  formatNetworkScopeLabel,
  type NetworkScopeState,
} from "./networkScope";
import type { GraphEdge, GraphNode, NetworkPlaylistOption } from "./networkTypes";

type PushNetworkUrl = (patch: NetworkUrlPatch) => void;

/** Graph-scope dropdown options: all catalog / playlists, custom scope, then each playlist. */
export function buildNetworkScopeMenuOptions(
  scopePlaylists: NetworkPlaylistOption[],
  networkScope: NetworkScopeState,
  playlistNameByKey: Map<string, string>,
  catalogScopeLabel: string,
): MenuSelectOption[] {
  /* Match dashboard `Combobox` `isAllCatalog` tile (accent + Music). */
  const catalogThumb = (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
      style={{ backgroundColor: "var(--sb-accent)" }}
      aria-hidden
    >
      <Music className="h-3.5 w-3.5" strokeWidth={2} style={{ color: "black" }} />
    </div>
  );
  const customThumb = (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[10px] font-semibold"
      style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-accent)" }}
      aria-hidden
    >
      +
    </div>
  );
  const customLabel =
    networkScope.mode === "custom"
      ? formatNetworkScopeLabel(networkScope, playlistNameByKey)
      : "Custom playlist scope…";
  return [
    { value: SCOPE_CATALOG, label: catalogScopeLabel, leading: catalogThumb },
    { value: SCOPE_CUSTOM, label: customLabel, leading: customThumb },
    ...scopePlaylists.map((p) => ({
      value: p.playlist_key,
      label: p.display_name,
      leading: p.spotify_playlist_image_url ? (
        <PreviewableArtwork
          src={p.spotify_playlist_image_url}
          alt={p.display_name}
          width={24}
          height={24}
          interactive="inline"
          className="h-6 w-6 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div
          className="h-6 w-6 shrink-0 rounded-lg"
          style={{ backgroundColor: "var(--sb-surface)" }}
          aria-hidden
        />
      ),
    })),
  ];
}

/** Graph scope: catalog, a single playlist, or a custom playlist scope (opens the modal). */
export function NetworkScopeMenu({
  scopeMenuValue,
  playlistScopeOptions,
  catalogScopeLabel,
  pushNetworkUrl,
  setCustomScopeModalOpen,
}: {
  scopeMenuValue: string;
  playlistScopeOptions: MenuSelectOption[];
  catalogScopeLabel: string;
  pushNetworkUrl: PushNetworkUrl;
  setCustomScopeModalOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <MenuSelect
      value={scopeMenuValue}
      options={playlistScopeOptions}
      onChange={(v) => {
        if (v === SCOPE_CATALOG) {
          pushNetworkUrl({ scope: DEFAULT_NETWORK_SCOPE });
          return;
        }
        if (v === SCOPE_CUSTOM) {
          setCustomScopeModalOpen(true);
          return;
        }
        pushNetworkUrl({
          scope: {
            mode: "playlist",
            playlistKey: v,
            customPlaylistKeys: [],
            customPlaylistMode: "any",
          },
        });
      }}
      ariaLabel="Graph scope: catalog, playlist, or custom playlists"
      placeholder={catalogScopeLabel}
      matchTriggerWidth={false}
      className="min-w-[10rem] max-w-[min(100vw-8rem,17rem)]"
      menuClassName="max-h-80 min-w-[min(100vw-2rem,17rem)] overflow-y-auto"
    />
  );
}

/** Co-artist min / max range + count basis (playlist-wide vs lead rows). */
export function NetworkCoArtistFilter({
  colors,
  collabMinDraft,
  setCollabMinDraft,
  collabMaxDraft,
  setCollabMaxDraft,
  commitCollabRange,
  collabCountBasis,
  setCollabCountBasis,
  pushNetworkUrl,
}: {
  colors: ThemeColors;
  collabMinDraft: string;
  setCollabMinDraft: Dispatch<SetStateAction<string>>;
  collabMaxDraft: string;
  setCollabMaxDraft: Dispatch<SetStateAction<string>>;
  commitCollabRange: () => void;
  collabCountBasis: CollabCountBasis;
  setCollabCountBasis: Dispatch<SetStateAction<CollabCountBasis>>;
  pushNetworkUrl: PushNetworkUrl;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
      style={{
        backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        color: colors.text,
      }}
    >
      <span
        className="shrink-0 pl-0.5"
        style={{ color: colors.muted }}
        title="Filter artists by how many distinct other artists share at least one in-scope track with them. Min and max are inclusive (0–999); leave either blank for no bound. Blur or press Enter to apply. Use Playlist vs Lead only to choose how co-artists are counted."
      >
        Co-artists
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Min"
        aria-label="Minimum co-artist count on tracks (inclusive)"
        className="w-11 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
          color: colors.text,
        }}
        value={collabMinDraft}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^\d*$/.test(v)) setCollabMinDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={commitCollabRange}
      />
      <span style={{ color: colors.muted }}>–</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Max"
        aria-label="Maximum co-artist count on tracks (inclusive)"
        className="w-11 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
          color: colors.text,
        }}
        value={collabMaxDraft}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^\d*$/.test(v)) setCollabMaxDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={commitCollabRange}
      />
      <div className="flex rounded-md overflow-hidden border shrink-0" style={{ borderColor: colors.border }}>
        <button
          type="button"
          className="px-2 py-1 font-medium transition-colors"
          aria-label="Co-artist count: playlist-wide (any credit on scoped tracks)"
          title="Playlist: count distinct co-artists from every credit on in-scope tracks—any position on the track, not only where this artist is lead."
          style={{
            backgroundColor:
              collabCountBasis === "playlist"
                ? accentRgba(colors.accent, colors.isDark ? 0.14 : 0.2)
                : "transparent",
            color: collabCountBasis === "playlist" ? colors.text : colors.muted,
          }}
          onClick={() => {
            if (collabCountBasis === "playlist") return;
            setCollabCountBasis("playlist");
            pushNetworkUrl({ collabCountBasis: "playlist" });
          }}
        >
          Playlist
        </button>
        <button
          type="button"
          className="px-2 py-1 font-medium transition-colors border-l"
          aria-label="Co-artist count: lead rows only"
          title="Lead only: count co-artists only on ISRCs where this artist is the primary (first Spotify credit) on that track."
          style={{
            borderColor: colors.border,
            backgroundColor:
              collabCountBasis === "primary_rows"
                ? accentRgba(colors.accent, colors.isDark ? 0.14 : 0.2)
                : "transparent",
            color: collabCountBasis === "primary_rows" ? colors.text : colors.muted,
          }}
          onClick={() => {
            if (collabCountBasis === "primary_rows") return;
            setCollabCountBasis("primary_rows");
            pushNetworkUrl({ collabCountBasis: "primary_rows" });
          }}
        >
          Lead only
        </button>
      </div>
    </div>
  );
}

/** In-scope track-count min / max bounds for visible nodes. */
export function NetworkTrackCountFilter({
  colors,
  isCrossLabelMode,
  trackCountMinDraft,
  setTrackCountMinDraft,
  setTrackCountMin,
  trackCountMaxDraft,
  setTrackCountMaxDraft,
  setTrackCountMax,
  pushNetworkUrl,
}: {
  colors: ThemeColors;
  isCrossLabelMode: boolean;
  trackCountMinDraft: string;
  setTrackCountMinDraft: Dispatch<SetStateAction<string>>;
  setTrackCountMin: Dispatch<SetStateAction<number | null>>;
  trackCountMaxDraft: string;
  setTrackCountMaxDraft: Dispatch<SetStateAction<string>>;
  setTrackCountMax: Dispatch<SetStateAction<number | null>>;
  pushNetworkUrl: PushNetworkUrl;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
      style={{
        backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        color: colors.text,
      }}
    >
      <span
        className="shrink-0 pl-0.5"
        style={{ color: colors.muted }}
        title="Filter visible nodes by each artist's in-scope track count (the same track_count used on the graph). Min and max are inclusive; leave blank for no bound."
      >
        {isCrossLabelMode ? "Label tracks" : "Node tracks"}
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Min"
        aria-label="Minimum in-scope track count on graph nodes"
        className="w-14 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
          color: colors.text,
        }}
        value={trackCountMinDraft}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^\d*$/.test(v)) setTrackCountMinDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          const parsed = parseTrackCountInputDraft(trackCountMinDraft);
          setTrackCountMin(parsed);
          setTrackCountMinDraft(parsed == null ? "" : String(parsed));
          pushNetworkUrl({ trackCountMin: parsed });
        }}
      />
      <span style={{ color: colors.muted }}>–</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="Max"
        aria-label="Maximum in-scope track count on graph nodes"
        className="w-14 min-w-0 rounded px-1.5 py-1 font-mono text-xs tabular-nums outline-none border"
        style={{
          borderColor: colors.border,
          backgroundColor: colors.isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.7)",
          color: colors.text,
        }}
        value={trackCountMaxDraft}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^\d*$/.test(v)) setTrackCountMaxDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => {
          const parsed = parseTrackCountInputDraft(trackCountMaxDraft);
          setTrackCountMax(parsed);
          setTrackCountMaxDraft(parsed == null ? "" : String(parsed));
          pushNetworkUrl({ trackCountMax: parsed });
        }}
      />
    </div>
  );
}

/** Icon toggles + actions: scale, images, region select, hide non-primary, table, advanced filter, export, help, reset. */
export function NetworkToolbarActions({
  colors,
  isCrossLabelMode,
  isCompetitorDataset,
  scaleByTracks,
  showImages,
  boxSelectArmed,
  setBoxSelectArmed,
  hideNonPrimary,
  tableView,
  pushNetworkUrl,
  networkAdvAppliedCount,
  setNetworkAdvModalOpen,
  xlsxExportPhase,
  xlsxExporting,
  handleExportViewXlsx,
  setShortcutsOpen,
  handleReset,
}: {
  colors: ThemeColors;
  isCrossLabelMode: boolean;
  isCompetitorDataset: boolean;
  scaleByTracks: boolean;
  showImages: boolean;
  boxSelectArmed: boolean;
  setBoxSelectArmed: Dispatch<SetStateAction<boolean>>;
  hideNonPrimary: boolean;
  tableView: boolean;
  pushNetworkUrl: PushNetworkUrl;
  networkAdvAppliedCount: number;
  setNetworkAdvModalOpen: Dispatch<SetStateAction<boolean>>;
  xlsxExportPhase: string | null;
  xlsxExporting: boolean;
  handleExportViewXlsx: () => Promise<void>;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  handleReset: () => void;
}) {
  return (
    <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto min-w-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <ToggleButton
        active={scaleByTracks}
        onClick={() => pushNetworkUrl({ scaleByTracks: !scaleByTracks })}
        icon={<Scaling size={14} />}
        title="Scale by tracks"
        colors={colors}
      />

      <ToggleButton
        active={showImages}
        onClick={() => pushNetworkUrl({ showImages: !showImages })}
        icon={<ImageIcon size={14} />}
        title="Show images"
        colors={colors}
      />

      <ToggleButton
        active={boxSelectArmed}
        onClick={() => setBoxSelectArmed((v) => !v)}
        icon={<SquareDashed size={14} />}
        title="Select region"
        colors={colors}
      />

      {!isCrossLabelMode ? (
        <ToggleButton
          active={hideNonPrimary}
          onClick={() => pushNetworkUrl({ hideNonPrimary: !hideNonPrimary })}
          icon={<UserX size={14} />}
          title="Hide non-primary"
          colors={colors}
        />
      ) : null}

      <ToggleButton
        active={tableView}
        onClick={() => pushNetworkUrl({ tableView: !tableView })}
        icon={<Table2 size={14} />}
        title="Table view"
        colors={colors}
      />

      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        title="Advanced filters"
        aria-label="Open advanced artist filters"
        onClick={() => setNetworkAdvModalOpen(true)}
        className="!h-8 !w-8 shrink-0 !rounded-lg"
        style={{
          color: networkAdvAppliedCount > 0 ? colors.accent : colors.muted,
          backgroundColor:
            networkAdvAppliedCount > 0
              ? accentRgba(colors.accent, colors.isDark ? 0.12 : 0.15)
              : colors.isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(0,0,0,0.04)",
        }}
      >
        <Filter className="h-3.5 w-3.5" aria-hidden />
      </IconButton>

      <div className="w-px h-5 shrink-0 self-center" style={{ backgroundColor: colors.border }} />

      {xlsxExportPhase ? (
        <span
          className="text-[11px] tabular-nums truncate max-w-[7rem] sm:max-w-[14rem] shrink-0"
          style={{ color: colors.muted }}
        >
          {xlsxExportPhase}
        </span>
      ) : null}

      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        title={
          isCompetitorDataset
            ? "Excel export is not available in Competitor Mode yet"
            : "Download Excel"
        }
        aria-label="Download Excel export of current network view"
        disabled={xlsxExporting || isCompetitorDataset}
        onClick={() => void handleExportViewXlsx()}
        className="!h-8 !w-8 shrink-0 !rounded-lg"
        style={{
          color: colors.muted,
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        }}
      >
        {xlsxExporting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden />
        )}
      </IconButton>

      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        title="Help"
        aria-label="Help and shortcuts"
        onClick={() => setShortcutsOpen(true)}
        className="!h-8 !w-8 shrink-0 !rounded-lg"
        style={{
          color: colors.muted,
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        }}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </IconButton>

      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        title="Reset"
        aria-label="Reset network view — clear selection, filters, search, saved camera; fit graph"
        onClick={handleReset}
        className="!h-8 !w-8 shrink-0 !rounded-lg"
        style={{
          color: colors.muted,
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      </IconButton>
    </div>
  );
}

/** Artist search box with a dropdown of visible matches (click focuses the artist on the graph). */
export function NetworkArtistSearch({
  colors,
  searchInputRef,
  searchQuery,
  setSearchQuery,
  searchOpen,
  setSearchOpen,
  searchResults,
  focusOnArtist,
}: {
  colors: ThemeColors;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  searchResults: GraphNode[];
  focusOnArtist: (artistId: string) => void;
}) {
  return (
    <div className="relative min-w-0 w-full max-sm:basis-full sm:w-auto sm:max-w-md shrink sm:shrink-0">
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm w-full min-w-0"
        style={{
          backgroundColor: colors.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          color: colors.text,
        }}
      >
        <Search size={14} className="shrink-0" style={{ color: colors.muted }} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search artist…"
          className="bg-transparent outline-none min-w-0 flex-1 sm:w-44 sm:flex-initial placeholder:opacity-40"
          style={{ color: colors.text }}
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => {
            // Delay so click on result fires first
            setTimeout(() => setSearchOpen(false), 200);
          }}
        />
      </div>

      {/* Search dropdown */}
      {searchOpen && searchResults.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 sm:right-auto mt-1 rounded-lg shadow-lg z-50 overflow-hidden max-h-[300px] overflow-y-auto w-full sm:w-64 min-w-0"
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
          }}
        >
          {searchResults.map((r) => (
            <button
              key={r.id}
              className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:brightness-125 transition-all"
              style={{ color: colors.text }}
              onMouseDown={(e) => {
                e.preventDefault();
                focusOnArtist(r.id);
              }}
            >
              {r.image_url ? (
                <PreviewableArtwork
                  src={r.image_url}
                  alt={r.name}
                  className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                  interactive="inline"
                />
              ) : (
                <div
                  className="w-6 h-6 rounded-full flex-shrink-0"
                  style={{ backgroundColor: colors.accent + "30" }}
                />
              )}
              <span className="truncate">{r.name}</span>
              <span className="ml-auto text-xs flex-shrink-0" style={{ color: colors.muted }}>
                {r.track_count} tracks
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Combined-filters summary row + visible / full graph counts. */
export function NetworkToolbarStats({
  colors,
  activeFiltersSummary,
  networkScope,
  playlistNameByKey,
  collabFilterMin,
  collabFilterMax,
  trackCountMinEffective,
  trackCountMaxEffective,
  networkAdvAppliedCount,
  graphData,
  nodes,
  edges,
}: {
  colors: ThemeColors;
  activeFiltersSummary: string[];
  networkScope: NetworkScopeState;
  playlistNameByKey: Map<string, string>;
  collabFilterMin: number | null;
  collabFilterMax: number | null;
  trackCountMinEffective: number | null;
  trackCountMaxEffective: number | null;
  networkAdvAppliedCount: number;
  graphData: { nodes: GraphNode[]; links: GraphEdge[] };
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  return (
    <>
      {activeFiltersSummary.length > 0 ? (
        <div
          className="basis-full w-full flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 mt-1 -mx-4 px-4 text-[10px] leading-snug"
          style={{ borderColor: colors.border, color: colors.muted }}
        >
          <span className="font-semibold uppercase tracking-wide opacity-80 shrink-0">
            Combined filters
          </span>
          <span className="min-w-0">
            {activeFiltersSummary.map((t, i) => (
              <span key={i}>
                {i > 0 ? " · " : null}
                {t}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {/* Stats */}
      <div className="ml-auto text-xs text-right" style={{ color: colors.muted }}>
        {networkScope.mode === "playlist" || networkScope.mode === "custom" ? (
          <span className="block sm:inline">
            Scoped: {formatNetworkScopeLabel(networkScope, playlistNameByKey)}
            {" · "}
          </span>
        ) : null}
        {collabRangeIsActive(collabFilterMin, collabFilterMax) ||
        trackCountMinEffective != null ||
        trackCountMaxEffective != null ||
        networkAdvAppliedCount > 0 ? (
          <>
            <span className="whitespace-nowrap">
              {graphData.nodes.length} visible
              {collabRangeIsActive(collabFilterMin, collabFilterMax) ? (
                <>
                  {" "}
                  ({formatCollabRangeSummary(collabFilterMin, collabFilterMax)} co-artists)
                </>
              ) : null}
              {(trackCountMinEffective != null || trackCountMaxEffective != null) && (
                <>
                  {" "}
                  (
                  {trackCountMinEffective != null ? `≥${trackCountMinEffective}` : "any min"} tracks →{" "}
                  {trackCountMaxEffective != null ? `≤${trackCountMaxEffective}` : "any max"})
                </>
              )}
              {" · "}
              {graphData.links.length} links
            </span>
            <span className="opacity-70"> — full </span>
          </>
        ) : null}
        {nodes.length} artists &middot; {edges.length} collabs
      </div>
    </>
  );
}

/** Status strips under the toolbar: advanced-filter stream stats loading / error, export notices. */
export function NetworkToolbarBanners({
  colors,
  networkAdvFilterApplied,
  networkAdvStreamStatsLoading,
  networkAdvStreamStatsError,
  setNetworkAdvStreamStatsError,
  xlsxExportAlert,
  setXlsxExportAlert,
}: {
  colors: ThemeColors;
  networkAdvFilterApplied: FilterConfig | null;
  networkAdvStreamStatsLoading: boolean;
  networkAdvStreamStatsError: string | null;
  setNetworkAdvStreamStatsError: Dispatch<SetStateAction<string | null>>;
  xlsxExportAlert: string | null;
  setXlsxExportAlert: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <>
      {networkAdvFilterApplied &&
      hasActiveConditions(networkAdvFilterApplied) &&
      networkFilterUsesStreamFields(networkAdvFilterApplied) &&
      networkAdvStreamStatsLoading ? (
        <div
          className="flex items-center gap-2 px-4 py-1.5 border-b text-xs"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.isDark ? "rgba(59,130,246,0.14)" : "rgba(59,130,246,0.1)",
            color: colors.text,
          }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
          <span>Loading stream stats for advanced filter…</span>
        </div>
      ) : null}

      {networkAdvStreamStatsError &&
      networkAdvFilterApplied &&
      hasActiveConditions(networkAdvFilterApplied) &&
      networkFilterUsesStreamFields(networkAdvFilterApplied) ? (
        <div
          className="flex items-start gap-2 px-4 py-2 border-b text-sm"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.15)",
            color: colors.text,
          }}
        >
          <span className="flex-1 min-w-0">{networkAdvStreamStatsError}</span>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 hover:opacity-80"
            style={{ color: colors.muted }}
            aria-label="Dismiss stream stats error"
            onClick={() => setNetworkAdvStreamStatsError(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {xlsxExportAlert ? (
        <div
          className="flex items-start gap-2 px-4 py-2 border-b text-sm"
          style={{
            borderColor: colors.border,
            backgroundColor: colors.isDark ? "rgba(245,158,11,0.12)" : "rgba(245,158,11,0.15)",
            color: colors.text,
          }}
        >
          <span className="flex-1 min-w-0">{xlsxExportAlert}</span>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 hover:opacity-80"
            style={{ color: colors.muted }}
            aria-label="Dismiss export notice"
            onClick={() => setXlsxExportAlert(null)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}
