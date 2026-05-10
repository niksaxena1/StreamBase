"use client";

/**
 * Filter Builder Component
 * 
 * Main collapsible section for building and applying dynamic filters
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchApiJson } from "@/lib/api";
import { 
  Play, 
  Plus, 
  RotateCcw, 
  Sparkles,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import type {
  FilterConfig,
  FilterGroup as FilterGroupType,
  EntityType,
  FilterGroupJoinLogic,
  FilterResult,
} from "./filterTypes";
import { createEmptyFilter, createEmptyGroup } from "./filterTypes";
import { ENTITY_CONFIGS } from "./filterConfig";
import { FilterGroup, GroupSummary } from "./FilterGroup";
import { SavedFilters } from "./SavedFilters";
import { FilterResults } from "./FilterResults";
import { 
  filterTracksClientSide, 
  filterArtistsClientSide, 
  filterPlaylistsClientSide,
  filterDatesClientSide,
  aggregateTracksToArtistData,
  hasActiveConditions,
  countActiveConditions,
  type TrackDataPoint,
  type PlaylistDataPoint,
  type DateDataPoint,
} from "./filterQuery";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const STORAGE_KEY_OPEN = "sb:filters:section_open";

function extractValuesFromFilter(f: FilterConfig | null, fieldName: string): string[] {
  if (!f) return [];
  const out = new Set<string>();
  for (const g of f.groups ?? []) {
    for (const c of g.conditions ?? []) {
      if (!c?.enabled) continue;
      if (c.field !== fieldName) continue;
      if (Array.isArray(c.value)) {
        for (const v of c.value) {
          const s = String(v ?? "").trim();
          if (s) out.add(s);
        }
      } else if (c.value != null && c.value !== "") {
        out.add(String(c.value).trim());
      }
    }
  }
  return Array.from(out);
}

function extractPlaylistKeysFromFilter(f: FilterConfig | null): string[] {
  return extractValuesFromFilter(f, "playlist");
}

function filterUsesAnyField(f: FilterConfig | null, ...fieldNames: string[]): boolean {
  if (!f) return false;
  for (const g of f.groups ?? []) {
    for (const c of g.conditions ?? []) {
      if (c?.enabled && fieldNames.includes(c.field)) return true;
    }
  }
  return false;
}

type FilterBuilderProps = {
  // Track data from home page (for client-side filtering)
  trackData: TrackDataPoint[];
  // Playlist data 
  playlistData: PlaylistDataPoint[];
  // Date data (per-playlist or catalog-wide daily aggregates)
  dateData: DateDataPoint[];
  // Current playlist scope for dates entity
  dateScopePlaylistKey?: string;
  onDateScopeChange?: (key: string) => void;
  // Artist image map
  artistImages: Map<string, { name: string; image_url: string | null; in_house?: boolean }>;
  // Dynamic options for select fields
  artistOptions: Array<{ value: string; label: string; imageUrl?: string | null }>;
  playlistOptions: Array<{ value: string; label: string; imageUrl?: string | null; isAllCatalog?: boolean }>;
  asOfRunDate?: string | null;
};

export function FilterBuilder({
  trackData,
  playlistData,
  dateData,
  dateScopePlaylistKey = "all_catalog",
  onDateScopeChange,
  artistImages,
  artistOptions,
  playlistOptions,
  asOfRunDate = null,
}: FilterBuilderProps) {
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  // Section open/closed state (persisted)
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true); // Filter editor expanded vs collapsed
  
  // Current filter being edited
  const [currentFilter, setCurrentFilter] = useState<FilterConfig | null>(null);
  
  // Results state
  const [results, setResults] = useState<FilterResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasApplied, setHasApplied] = useState(false);
  const pendingAutoApply = useRef(false);

  // Movement date range for moved_distro / moved_entity fields
  const [movementStartDate, setMovementStartDate] = useState<string>("");
  const [movementEndDate, setMovementEndDate] = useState<string>("");
  
  // Load open state from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY_OPEN);
      if (stored === "1") setIsOpen(true);
    } catch {
      // ignore
    }
  }, []);
  
  // Save open state
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY_OPEN, isOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [isOpen]);
  
  // Initialize with empty tracks filter when opening
  useEffect(() => {
    if (isOpen && !currentFilter) {
      setCurrentFilter(createEmptyFilter("tracks"));
    }
  }, [isOpen, currentFilter]);
  
  // Aggregate artist data from tracks
  const baseArtistData = useMemo(() => {
    return aggregateTracksToArtistData(trackData, artistImages);
  }, [trackData, artistImages]);

  // Playlist memberships cache (playlist_key -> Set<isrc>) for current date
  const [membershipByPlaylistKey, setMembershipByPlaylistKey] = useState<Map<string, Set<string>>>(new Map());
  const [membershipDate, setMembershipDate] = useState<string | null>(asOfRunDate);

  useEffect(() => {
    // Reset membership cache when date changes
    if (asOfRunDate && asOfRunDate !== membershipDate) {
      setMembershipByPlaylistKey(new Map());
      setMembershipDate(asOfRunDate);
    }
  }, [asOfRunDate, membershipDate]);

  async function ensurePlaylistMemberships(playlistKeys: string[]): Promise<Map<string, Set<string>>> {
    const date = asOfRunDate;
    if (!date) return membershipByPlaylistKey;
    const missing = playlistKeys.filter((k) => !membershipByPlaylistKey.has(k));
    if (missing.length === 0) return membershipByPlaylistKey;

    const BATCH = 25;
    const allRows: any[] = [];
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const json = await fetchApiJson<{ rows?: any[] }>("/api/playlists/memberships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, playlist_keys: chunk }),
      });
      const rows = Array.isArray(json.rows) ? json.rows : [];
      allRows.push(...rows);
    }

    const next = new Map(membershipByPlaylistKey);
    for (const k of missing) next.set(k, new Set<string>());
    for (const r of allRows) {
      const pk = String(r?.playlist_key ?? "").trim();
      const isrc = String(r?.isrc ?? "").trim().toUpperCase();
      if (!pk || !isrc) continue;
      const set = next.get(pk);
      if (set) set.add(isrc);
    }
    setMembershipByPlaylistKey(next);
    return next;
  }
  
  // Eagerly load distro playlist memberships for concentration view
  useEffect(() => {
    if (!isOpen || !asOfRunDate || !playlistData.length) return;
    const distroKeys = playlistData.filter((p) => p.playlist_type === "Distro").map((p) => p.playlist_key);
    if (!distroKeys.length) return;
    const missing = distroKeys.filter((k) => !membershipByPlaylistKey.has(k));
    if (!missing.length) return;
    void ensurePlaylistMemberships(missing).catch(() => { /* ignore */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, asOfRunDate, playlistData]);

  // Build distro-by-ISRC map from Distro playlists + memberships (for concentration view)
  const distroByIsrc = useMemo(() => {
    const map = new Map<string, { name: string; imageUrl: string | null }>();
    const distroPlaylists = playlistData.filter((p) => p.playlist_type === "Distro");
    for (const dp of distroPlaylists) {
      const members = membershipByPlaylistKey.get(dp.playlist_key);
      if (!members) continue;
      const info = { name: dp.display_name, imageUrl: dp.spotify_playlist_image_url ?? null };
      for (const isrc of members) {
        if (!map.has(isrc)) map.set(isrc, info);
      }
    }
    return map;
  }, [playlistData, membershipByPlaylistKey]);

  // Build track options for the "Contains Track" multi-select on playlists
  const trackOptions = useMemo(() => {
    return trackData.map((t) => ({
      value: t.isrc,
      label: `${t.name} — ${t.spotify_artist_names?.join(", ") ?? "Unknown"}`,
      imageUrl: t.spotify_album_image_url,
    }));
  }, [trackData]);

  // Dynamic options map for FilterCondition
  const dynamicOptions = useMemo(() => ({
    artists: artistOptions,
    playlists: playlistOptions,
    tracks: trackOptions,
  }), [artistOptions, playlistOptions, trackOptions]);
  
  // Whether the current filter uses movement fields
  const showMovementDateRange = currentFilter?.entityType === "tracks" &&
    filterUsesAnyField(currentFilter, "moved_distro", "moved_entity");

  // Count active conditions
  const activeConditionCount = currentFilter ? countActiveConditions(currentFilter) : 0;
  
  // Handle entity type change
  function handleEntityTypeChange(entityType: EntityType) {
    setCurrentFilter(createEmptyFilter(entityType));
    setResults([]);
    setHasApplied(false);
    setError(null);
  }
  
  // Handle group changes
  function handleGroupChange(index: number, group: FilterGroupType) {
    if (!currentFilter) return;
    const newGroups = [...currentFilter.groups];
    newGroups[index] = group;
    setCurrentFilter({ ...currentFilter, groups: newGroups, updatedAt: new Date().toISOString() });
  }
  
  // Handle group removal
  function handleGroupRemove(index: number) {
    if (!currentFilter || currentFilter.groups.length <= 1) return;
    const newGroups = currentFilter.groups.filter((_, i) => i !== index);
    setCurrentFilter({ ...currentFilter, groups: newGroups, updatedAt: new Date().toISOString() });
  }
  
  // Add new group
  function handleAddGroup() {
    if (!currentFilter) return;
    setCurrentFilter({
      ...currentFilter,
      groups: [...currentFilter.groups, createEmptyGroup()],
      updatedAt: new Date().toISOString(),
    });
  }

  function handleGroupJoinLogicChange(logic: FilterGroupJoinLogic) {
    if (!currentFilter) return;
    setCurrentFilter({
      ...currentFilter,
      groupJoinLogic: logic,
      updatedAt: new Date().toISOString(),
    });
  }
  
  // Reset filter
  function handleReset() {
    if (!currentFilter) return;
    setCurrentFilter(createEmptyFilter(currentFilter.entityType));
    setResults([]);
    setHasApplied(false);
    setError(null);
  }
  
  // Apply filter
  const handleApply = useCallback(() => {
    if (!currentFilter) return;
    
    setIsLoading(true);
    setError(null);
    
    // Use setTimeout to allow UI to update before potentially heavy filtering
    setTimeout(() => {
        (async () => {
          const playlistKeys = extractPlaylistKeysFromFilter(currentFilter);

          // Resolve collector conditions to playlist keys
          const collectorValues = extractValuesFromFilter(currentFilter, "collector");
          const collectorPlaylistMap = new Map<string, string[]>();
          if (collectorValues.length) {
            for (const cv of collectorValues) {
              const keys = playlistData
                .filter((p) => p.collector === cv)
                .map((p) => p.playlist_key);
              collectorPlaylistMap.set(cv, keys);
            }
          }
          const collectorPlaylistKeys = Array.from(collectorPlaylistMap.values()).flat();

          // Determine if filter references distro/entity playlist fields
          const needsDistroEntity = filterUsesAnyField(
            currentFilter,
            "in_multiple_distro", "in_multiple_entity",
          );

          let distroKeys: string[] = [];
          let entityKeys: string[] = [];
          if (needsDistroEntity) {
            distroKeys = playlistData.filter((p) => p.playlist_type === "Distro").map((p) => p.playlist_key);
            entityKeys = playlistData.filter((p) => p.playlist_type === "Entity").map((p) => p.playlist_key);
          }

          // Merge all playlist keys that need membership lookups
          const allPlaylistKeys = [...new Set([...playlistKeys, ...collectorPlaylistKeys, ...distroKeys, ...entityKeys])];

          let memberships = membershipByPlaylistKey;
          if (allPlaylistKeys.length && asOfRunDate) {
            memberships = await ensurePlaylistMemberships(allPlaylistKeys);
          }

          // Build reverse lookups
          const playlistCollectorMap = new Map<string, string>();
          for (const p of playlistData) {
            if (p.collector) playlistCollectorMap.set(p.playlist_key, p.collector);
          }
          const distroKeySet = new Set(distroKeys);
          const entityKeySet = new Set(entityKeys);

          // Annotate trackData with playlist_keys, _collectors, and distro/entity resolution
          const needsPlaylistAnnotation = allPlaylistKeys.length > 0;
          const trackDataWithPlaylists: TrackDataPoint[] = needsPlaylistAnnotation
            ? trackData.map((t) => {
                const keys: string[] = [];
                const collectors = new Set<string>();
                const distroMatches: string[] = [];
                const entityMatches: string[] = [];
                for (const pk of allPlaylistKeys) {
                  const set = memberships.get(pk);
                  if (set && set.has(t.isrc)) {
                    keys.push(pk);
                    const col = playlistCollectorMap.get(pk);
                    if (col) collectors.add(col);
                    if (distroKeySet.has(pk)) distroMatches.push(pk);
                    if (entityKeySet.has(pk)) entityMatches.push(pk);
                  }
                }
                return {
                  ...t,
                  playlist_keys: keys,
                  _collectors: Array.from(collectors),
                  ...(needsDistroEntity ? {
                    _distro_count: distroMatches.length,
                    _entity_count: entityMatches.length,
                  } : {}),
                };
              })
            : trackData;

          // Derive artist data from annotated tracks (so playlist/collector filter works for artists too)
          const artistData = needsPlaylistAnnotation
            ? aggregateTracksToArtistData(trackDataWithPlaylists, artistImages)
            : baseArtistData;

          // For playlist containment filters, resolve which playlists match
          let playlistDataForFilter = playlistData;
          if (currentFilter.entityType === "playlists" && asOfRunDate) {
            const containsTrackIsrcs = extractValuesFromFilter(currentFilter, "contains_track");
            const containsArtistIds = extractValuesFromFilter(currentFilter, "contains_artist");

            // Resolve artist IDs to ISRCs
            let allIsrcs = [...containsTrackIsrcs];
            if (containsArtistIds.length > 0) {
              for (const t of trackData) {
                const ids = t.spotify_artist_ids ?? [];
                if (ids.some((id) => containsArtistIds.includes(id))) {
                  allIsrcs.push(t.isrc);
                }
              }
            }
            // Deduplicate
            allIsrcs = [...new Set(allIsrcs)];

            if (allIsrcs.length > 0) {
              const BATCH = 500;
              const matchingKeys = new Set<string>();
              for (let i = 0; i < allIsrcs.length; i += BATCH) {
                const chunk = allIsrcs.slice(i, i + BATCH);
                const json = await fetchApiJson<{ playlist_keys?: string[] }>("/api/playlists/containing", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ date: asOfRunDate, isrcs: chunk }),
                });
                const keys: string[] = Array.isArray(json.playlist_keys) ? json.playlist_keys : [];
                for (const k of keys) matchingKeys.add(k);
              }
              playlistDataForFilter = playlistData.map((p) => ({
                ...p,
                _contains_match: matchingKeys.has(p.playlist_key),
              }));
            }
          }

          // Resolve movement fields via API (moved_distro / moved_entity)
          const needsMovedDistro = filterUsesAnyField(currentFilter, "moved_distro");
          const needsMovedEntity = filterUsesAnyField(currentFilter, "moved_entity");
          type PlaylistRef = { name: string; imageUrl: string | null };
          type MovementMap = Map<string, PlaylistRef[]>;
          const distroMovements: MovementMap = new Map();
          const entityMovements: MovementMap = new Map();

          function parseMovementResponse(json: any, target: MovementMap) {
            const mv = json?.movements;
            if (mv && typeof mv === "object") {
              for (const [isrc, detail] of Object.entries(mv)) {
                const d = detail as { playlists: PlaylistRef[] };
                if (Array.isArray(d?.playlists)) target.set(isrc, d.playlists);
              }
            }
          }

          const movementFetches: Promise<void>[] = [];
          if (needsMovedDistro) {
            movementFetches.push(
              fetchApiJson("/api/tracks/playlist-movements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "Distro",
                  start_date: movementStartDate || undefined,
                  end_date: movementEndDate || undefined,
                }),
              }).then((json: any) => parseMovementResponse(json, distroMovements)),
            );
          }
          if (needsMovedEntity) {
            movementFetches.push(
              fetchApiJson("/api/tracks/playlist-movements", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "Entity",
                  start_date: movementStartDate || undefined,
                  end_date: movementEndDate || undefined,
                }),
              }).then((json: any) => parseMovementResponse(json, entityMovements)),
            );
          }
          if (movementFetches.length) await Promise.all(movementFetches);

          // Annotate tracks with movement flags and playlist paths
          const needsMovementAnnotation = needsMovedDistro || needsMovedEntity;
          const trackDataWithMovements: TrackDataPoint[] = needsMovementAnnotation
            ? trackDataWithPlaylists.map((t) => ({
                ...t,
                _moved_distro: needsMovedDistro ? distroMovements.has(t.isrc) : undefined,
                _moved_entity: needsMovedEntity ? entityMovements.has(t.isrc) : undefined,
                _moved_distro_playlists: distroMovements.get(t.isrc),
                _moved_entity_playlists: entityMovements.get(t.isrc),
              }))
            : trackDataWithPlaylists;

          // Flag tracks that share their title with another track
          const titleCounts = new Map<string, number>();
          for (const t of trackDataWithMovements) {
            const key = (t.name ?? "").toLowerCase();
            titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
          }
          const trackDataWithTitles = trackDataWithMovements.map((t) => ({
            ...t,
            _has_duplicate_title: (titleCounts.get((t.name ?? "").toLowerCase()) ?? 0) > 1,
          }));

          // Pre-compute estimated revenue fields using the configured payout rate
          const rate = streamPayoutPerStreamUsd;
          const finalTrackData = trackDataWithTitles.map((t) => ({
            ...t,
            est_total_revenue: (t.total_streams_cumulative ?? 0) * rate,
            est_daily_revenue: (t.daily_streams ?? 0) * rate,
          }));
          const finalArtistData = artistData.map((a) => ({
            ...a,
            est_total_revenue: (a.total_streams ?? 0) * rate,
            est_daily_revenue: (a.daily_streams ?? 0) * rate,
          }));

          const finalPlaylistData = playlistDataForFilter.map((p) => ({
            ...p,
            est_total_revenue: (p.total_streams ?? 0) * rate,
            est_daily_revenue: p.daily_streams != null ? p.daily_streams * rate : null,
            est_monthly_revenue: p.daily_streams != null ? p.daily_streams * rate * 30 : null,
          }));

          let filteredResults: FilterResult[];
        
          switch (currentFilter.entityType) {
            case "tracks":
              filteredResults = filterTracksClientSide(finalTrackData, currentFilter);
              break;
            case "artists":
              filteredResults = filterArtistsClientSide(finalArtistData, currentFilter);
              break;
            case "playlists":
              filteredResults = filterPlaylistsClientSide(finalPlaylistData, currentFilter);
              break;
            case "dates":
              filteredResults = filterDatesClientSide(dateData, currentFilter);
              break;
            default:
              filteredResults = [];
          }
        
          setResults(filteredResults);
          setHasApplied(true);
        
        })()
          .catch((err) => {
            setError(err instanceof Error ? err.message : "An error occurred while filtering");
            setResults([]);
          })
          .finally(() => {
            setIsLoading(false);
          });
    }, 10);
  }, [currentFilter, trackData, playlistData, dateData, asOfRunDate, membershipByPlaylistKey, artistImages, baseArtistData, streamPayoutPerStreamUsd, movementStartDate, movementEndDate]);

  // Auto-apply after loading a saved filter (runs after re-render so handleApply has fresh state)
  useEffect(() => {
    if (pendingAutoApply.current) {
      pendingAutoApply.current = false;
      handleApply();
    }
  }, [handleApply]);
  
  // Load a saved filter
  function handleLoadFilter(filter: FilterConfig) {
    setCurrentFilter(filter);
    setResults([]);
    setHasApplied(false);
    setError(null);
    if (hasActiveConditions(filter)) {
      pendingAutoApply.current = true;
    }
  }
  
  // Save current filter
  function handleSaveFilter(filter: FilterConfig) {
    setCurrentFilter(filter);
  }
  
  
  // Get data count for current entity type
  const dataCount = currentFilter?.entityType === "tracks" 
    ? trackData.length 
    : currentFilter?.entityType === "artists"
    ? baseArtistData.length
    : currentFilter?.entityType === "dates"
    ? dateData.length
    : playlistData.length;

  const entityOptions: ComboboxOption[] = useMemo(
    () =>
      Object.values(ENTITY_CONFIGS).map((config) => ({
        value: config.entityType,
        label: config.label,
      })),
    [],
  );

  const dateScopeOptions: ComboboxOption[] = useMemo(
    () => playlistOptions.map((p) => ({ value: p.value, label: p.label, imageUrl: p.imageUrl })),
    [playlistOptions],
  );
  
  return (
    <details
      open={isOpen}
      onToggle={(ev) => setIsOpen(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Filters
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
          </div>
        </div>
      </summary>

      {/* Expanded content */}
      {currentFilter && (
        <div className="mt-3">
          <div className="mb-3 text-xs opacity-70 leading-snug" style={{ color: "var(--sb-muted)" }}>
            Build custom views of your data. Each group has its own AND/OR between conditions; when you add more than one
            group, use <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Combine groups</span> to choose AND vs OR
            between them (same as the network advanced filters).
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Saved filters dropdown */}
            <SavedFilters
              currentFilter={currentFilter}
              onLoad={handleLoadFilter}
              onSave={handleSaveFilter}
            />
            
            {/* Entity type selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Filtering:
              </span>
              <div className="sb-ring min-w-[140px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
                <Combobox
                  value={currentFilter.entityType}
                  options={entityOptions}
                  ariaLabel="Select entity type"
                  onChange={(v) => handleEntityTypeChange(v as EntityType)}
                  showThumbnails={false}
                />
              </div>
              <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                ({dataCount.toLocaleString()} total)
              </span>
            </div>

            {/* Playlist scope selector (only for Dates entity) */}
            {currentFilter.entityType === "dates" && onDateScopeChange && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  Scope:
                </span>
                <div className="sb-ring min-w-[180px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
                  <Combobox
                    value={dateScopePlaylistKey}
                    options={dateScopeOptions}
                    ariaLabel="Select playlist scope"
                    onChange={(v) => onDateScopeChange(v)}
                    showThumbnails
                  />
                </div>
              </div>
            )}

            {/* Movement date range (shown when moved_distro / moved_entity is used) */}
            {showMovementDateRange && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  Movement period:
                </span>
                <input
                  type="date"
                  value={movementStartDate}
                  onChange={(e) => setMovementStartDate(e.target.value)}
                  className="sb-ring rounded-lg bg-white/70 px-2 py-1.5 text-xs dark:bg-white/5"
                  style={{ color: "var(--sb-text)" }}
                  placeholder="Start"
                />
                <span className="text-xs opacity-40">–</span>
                <input
                  type="date"
                  value={movementEndDate}
                  onChange={(e) => setMovementEndDate(e.target.value)}
                  className="sb-ring rounded-lg bg-white/70 px-2 py-1.5 text-xs dark:bg-white/5"
                  style={{ color: "var(--sb-text)" }}
                  placeholder="End"
                />
                {(movementStartDate || movementEndDate) && (
                  <button
                    type="button"
                    onClick={() => { setMovementStartDate(""); setMovementEndDate(""); }}
                    className="text-xs px-2 py-1 rounded-lg hover:bg-white/10 transition"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    All time
                  </button>
                )}
                {!movementStartDate && !movementEndDate && (
                  <span className="text-xs opacity-50" style={{ color: "var(--sb-muted)" }}>
                    All time
                  </span>
                )}
              </div>
            )}
            
            {/* Spacer */}
            <div className="flex-1" />
            
            {/* Expand/collapse filter editor */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? "Collapse" : "Expand"} Editor
            </Button>
            
            {/* Reset button */}
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="h-4 w-4" />}
              onClick={handleReset}
              disabled={activeConditionCount === 0}
            >
              Reset
            </Button>
            
            {/* Apply button */}
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Play className="h-4 w-4" />}
              onClick={handleApply}
              disabled={!hasActiveConditions(currentFilter)}
            >
              Apply Filter
            </Button>
          </div>
          
          {/* Filter editor */}
          {isExpanded && (
            <div className="space-y-4">
              {currentFilter.groups.length > 1 ? (
                <div
                  className="flex flex-wrap items-center gap-2 text-[11px] rounded-lg px-2 py-1.5 sb-panel"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <span className="shrink-0 font-medium" style={{ color: "var(--sb-text)" }}>
                    Combine groups
                  </span>
                  <div className="flex rounded-md overflow-hidden border shrink-0" style={{ borderColor: "var(--sb-border)" }}>
                    <button
                      type="button"
                      className="px-2.5 py-1 font-medium transition-colors"
                      aria-label="Combine groups with AND"
                      style={{
                        backgroundColor:
                          (currentFilter.groupJoinLogic ?? "AND") === "AND" ? "var(--sb-accent)" : "transparent",
                        color: (currentFilter.groupJoinLogic ?? "AND") === "AND" ? "black" : "var(--sb-muted)",
                      }}
                      onClick={() => handleGroupJoinLogicChange("AND")}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      className="px-2.5 py-1 font-medium transition-colors border-l"
                      aria-label="Combine groups with OR"
                      style={{
                        borderColor: "var(--sb-border)",
                        backgroundColor:
                          currentFilter.groupJoinLogic === "OR" ? "var(--sb-accent)" : "transparent",
                        color: currentFilter.groupJoinLogic === "OR" ? "black" : "var(--sb-muted)",
                      }}
                      onClick={() => handleGroupJoinLogicChange("OR")}
                    >
                      OR
                    </button>
                  </div>
                  <span className="min-w-0 opacity-90">
                    {(currentFilter.groupJoinLogic ?? "AND") === "AND"
                      ? "Every group must match."
                      : "Match if any group matches."}
                  </span>
                </div>
              ) : null}

              {/* Groups */}
              {currentFilter.groups.map((group, index) => (
                <div key={group.id}>
                  {index > 0 && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex-1 h-px" style={{ background: "var(--sb-border)" }} />
                      <span
                        className="text-xs font-medium px-3 py-1 rounded-lg"
                        style={{
                          background: "var(--sb-accent)",
                          color: "black",
                        }}
                      >
                        {(currentFilter.groupJoinLogic ?? "AND") === "OR" ? "OR" : "AND"}
                      </span>
                      <div className="flex-1 h-px" style={{ background: "var(--sb-border)" }} />
                    </div>
                  )}
                  
                  <FilterGroup
                    group={group}
                    entityType={currentFilter.entityType}
                    dynamicOptions={dynamicOptions}
                    groupIndex={index}
                    totalGroups={currentFilter.groups.length}
                    onChange={(g) => handleGroupChange(index, g)}
                    onRemove={() => handleGroupRemove(index)}
                  />
                </div>
              ))}
              
              {/* Add group button */}
              <div className="flex justify-center pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={handleAddGroup}
                >
                  Add group
                </Button>
              </div>
            </div>
          )}
          
          {/* Collapsed summary */}
          {!isExpanded && activeConditionCount > 0 && (
            <div className="p-3 rounded-xl sb-panel">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4" style={{ color: "var(--sb-positive)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--sb-text)" }}>
                  Active Filter
                </span>
              </div>
              <div className="space-y-2">
                {currentFilter.groups.map((group, index) => (
                  <div key={group.id}>
                    {index > 0 && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--sb-accent)] text-black mr-2">
                        {(currentFilter.groupJoinLogic ?? "AND") === "OR" ? "OR" : "AND"}
                      </span>
                    )}
                    <GroupSummary
                      group={group}
                      entityType={currentFilter.entityType}
                      dynamicOptions={dynamicOptions}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Results */}
          {hasApplied && (
            <FilterResults
              entityType={currentFilter.entityType}
              results={results}
              isLoading={isLoading}
              error={error}
              distroByIsrc={distroByIsrc}
            />
          )}
          
          {/* No results applied yet hint */}
          {!hasApplied && activeConditionCount > 0 && (
            <div className="mt-4 p-4 rounded-xl border border-dashed flex items-center justify-center gap-2" style={{ borderColor: "var(--sb-border)" }}>
              <Play className="h-4 w-4" style={{ color: "var(--sb-muted)" }} />
              <span className="text-sm" style={{ color: "var(--sb-muted)" }}>
                Click &quot;Apply Filter&quot; to see results
              </span>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

// ============================================================================
// Export for use in page
// ============================================================================

export { type TrackDataPoint, type PlaylistDataPoint, type DateDataPoint } from "./filterQuery";
