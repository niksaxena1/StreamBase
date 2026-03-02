"use client";

/**
 * Filter Builder Component
 * 
 * Main collapsible section for building and applying dynamic filters
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { markFilterAsRecent } from "./filterStorage";
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
      }
    }
  }
  return Array.from(out);
}

function extractPlaylistKeysFromFilter(f: FilterConfig | null): string[] {
  return extractValuesFromFilter(f, "playlist");
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
  artistImages: Map<string, { name: string; image_url: string | null }>;
  // Dynamic options for select fields
  artistOptions: Array<{ value: string; label: string; imageUrl?: string | null }>;
  playlistOptions: Array<{ value: string; label: string; imageUrl?: string | null }>;
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

    const res = await fetch("/api/playlists/memberships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, playlist_keys: missing }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as any)?.error ?? "Failed to load playlist memberships");

    const rows = Array.isArray((json as any)?.rows) ? ((json as any).rows as any[]) : [];
    const next = new Map(membershipByPlaylistKey);
    for (const k of missing) next.set(k, new Set<string>());
    for (const r of rows) {
      const pk = String(r?.playlist_key ?? "").trim();
      const isrc = String(r?.isrc ?? "").trim().toUpperCase();
      if (!pk || !isrc) continue;
      const set = next.get(pk);
      if (set) set.add(isrc);
    }
    setMembershipByPlaylistKey(next);
    return next;
  }
  
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
          let memberships = membershipByPlaylistKey;
          if (playlistKeys.length && asOfRunDate) {
            memberships = await ensurePlaylistMemberships(playlistKeys);
          }

          // Annotate trackData with playlist_keys for selected playlists
          const trackDataWithPlaylists: TrackDataPoint[] = playlistKeys.length
            ? trackData.map((t) => {
                const keys: string[] = [];
                for (const pk of playlistKeys) {
                  const set = memberships.get(pk);
                  if (set && set.has(t.isrc)) keys.push(pk);
                }
                return { ...t, playlist_keys: keys };
              })
            : trackData;

          // Derive artist data from annotated tracks (so playlist filter works for artists too)
          const artistData = playlistKeys.length
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
              const res = await fetch("/api/playlists/containing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: asOfRunDate, isrcs: allIsrcs }),
              });
              const json = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error((json as any)?.error ?? "Failed to look up playlist memberships");

              const matchingKeys = new Set<string>(
                Array.isArray((json as any)?.playlist_keys) ? (json as any).playlist_keys : [],
              );
              // Annotate each playlist with whether it matches the containment filter
              playlistDataForFilter = playlistData.map((p) => ({
                ...p,
                _contains_match: matchingKeys.has(p.playlist_key),
              }));
            }
          }

          // Pre-compute estimated revenue fields using the configured payout rate
          const rate = streamPayoutPerStreamUsd;
          const finalTrackData = trackDataWithPlaylists.map((t) => ({
            ...t,
            est_total_revenue: (t.total_streams_cumulative ?? 0) * rate,
            est_daily_revenue: (t.daily_streams ?? 0) * rate,
          }));
          const finalArtistData = artistData.map((a) => ({
            ...a,
            est_total_revenue: (a.total_streams ?? 0) * rate,
            est_daily_revenue: (a.daily_streams ?? 0) * rate,
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
              filteredResults = filterPlaylistsClientSide(playlistDataForFilter, currentFilter);
              break;
            case "dates":
              filteredResults = filterDatesClientSide(dateData, currentFilter);
              break;
            default:
              filteredResults = [];
          }
        
          setResults(filteredResults);
          setHasApplied(true);
        
          // Mark as recent if filter has a name
          if (currentFilter.name) {
            markFilterAsRecent(currentFilter.id);
          }
        })()
          .catch((err) => {
            setError(err instanceof Error ? err.message : "An error occurred while filtering");
            setResults([]);
          })
          .finally(() => {
            setIsLoading(false);
          });
    }, 10);
  }, [currentFilter, trackData, playlistData, dateData, asOfRunDate, membershipByPlaylistKey, artistImages, baseArtistData, streamPayoutPerStreamUsd]);

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
          <div className="mb-3 text-xs opacity-70" style={{ color: "var(--sb-muted)" }}>
            Build custom views of your data
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
              {/* Groups */}
              {currentFilter.groups.map((group, index) => (
                <div key={group.id}>
                  {/* AND connector between groups */}
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
                        AND
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
                  Add Group (AND)
                </Button>
              </div>
            </div>
          )}
          
          {/* Collapsed summary */}
          {!isExpanded && activeConditionCount > 0 && (
            <div className="p-3 rounded-xl sb-panel">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4" style={{ color: "var(--sb-accent)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--sb-text)" }}>
                  Active Filter
                </span>
              </div>
              <div className="space-y-2">
                {currentFilter.groups.map((group, index) => (
                  <div key={group.id}>
                    {index > 0 && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--sb-accent)] text-black mr-2">
                        AND
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
            />
          )}
          
          {/* No results applied yet hint */}
          {!hasApplied && activeConditionCount > 0 && (
            <div className="mt-4 p-4 rounded-xl border border-dashed flex items-center justify-center gap-2" style={{ borderColor: "var(--sb-border)" }}>
              <Play className="h-4 w-4" style={{ color: "var(--sb-muted)" }} />
              <span className="text-sm" style={{ color: "var(--sb-muted)" }}>
                Click "Apply Filter" to see results
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
