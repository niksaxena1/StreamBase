"use client";

/**
 * Filter Builder Component
 * 
 * Main collapsible section for building and applying dynamic filters
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { 
  ChevronDown, 
  Filter, 
  Play, 
  Plus, 
  RotateCcw, 
  X,
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
  aggregateTracksToArtistData,
  hasActiveConditions,
  countActiveConditions,
  type TrackDataPoint,
  type PlaylistDataPoint,
} from "./filterQuery";
import { markFilterAsRecent } from "./filterStorage";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const STORAGE_KEY_OPEN = "sb:filters:section_open";

type FilterBuilderProps = {
  // Track data from home page (for client-side filtering)
  trackData: TrackDataPoint[];
  // Playlist data 
  playlistData: PlaylistDataPoint[];
  // Artist image map
  artistImages: Map<string, { name: string; image_url: string | null }>;
  // Dynamic options for select fields
  artistOptions: Array<{ value: string; label: string; imageUrl?: string | null }>;
  playlistOptions: Array<{ value: string; label: string; imageUrl?: string | null }>;
  collectorOptions?: Array<{ value: string; label: string }>;
};

export function FilterBuilder({
  trackData,
  playlistData,
  artistImages,
  artistOptions,
  playlistOptions,
  collectorOptions = [],
}: FilterBuilderProps) {
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
  const artistData = useMemo(() => {
    return aggregateTracksToArtistData(trackData, artistImages);
  }, [trackData, artistImages]);
  
  // Dynamic options map for FilterCondition
  const dynamicOptions = useMemo(() => ({
    artists: artistOptions,
    playlists: playlistOptions,
    collectors: collectorOptions,
  }), [artistOptions, playlistOptions, collectorOptions]);
  
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
      try {
        let filteredResults: FilterResult[];
        
        switch (currentFilter.entityType) {
          case "tracks":
            filteredResults = filterTracksClientSide(trackData, currentFilter);
            break;
          case "artists":
            filteredResults = filterArtistsClientSide(artistData, currentFilter);
            break;
          case "playlists":
            filteredResults = filterPlaylistsClientSide(playlistData, currentFilter);
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
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred while filtering");
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 10);
  }, [currentFilter, trackData, artistData, playlistData]);
  
  // Load a saved filter
  function handleLoadFilter(filter: FilterConfig) {
    setCurrentFilter(filter);
    setResults([]);
    setHasApplied(false);
    setError(null);
  }
  
  // Save current filter
  function handleSaveFilter(filter: FilterConfig) {
    setCurrentFilter(filter);
  }
  
  // Create new filter
  function handleNewFilter(entityType: EntityType) {
    setCurrentFilter(createEmptyFilter(entityType));
    setResults([]);
    setHasApplied(false);
    setError(null);
  }
  
  // Get data count for current entity type
  const dataCount = currentFilter?.entityType === "tracks" 
    ? trackData.length 
    : currentFilter?.entityType === "artists"
    ? artistData.length
    : playlistData.length;

  const entityOptions: ComboboxOption[] = useMemo(
    () =>
      Object.values(ENTITY_CONFIGS).map((config) => ({
        value: config.entityType,
        label: config.label,
      })),
    [],
  );
  
  return (
    <section className="sb-card p-4 mb-6">
      {/* Section header (always visible) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--sb-accent), #8B5CF6)" }}
          >
            <Filter className="h-5 w-5 text-black" />
          </div>
          <div className="text-left">
            <h2 className="text-base font-semibold" style={{ color: "var(--sb-text)" }}>
              Filters
            </h2>
            <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Build custom views of your data
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Show active filter badge when collapsed */}
          {!isOpen && activeConditionCount > 0 && (
            <span
              className="text-xs px-2 py-1 rounded-lg"
              style={{ background: "var(--sb-accent)", color: "black" }}
            >
              {activeConditionCount} condition{activeConditionCount !== 1 ? "s" : ""} active
            </span>
          )}
          
          <ChevronDown
            className={cx(
              "h-5 w-5 transition-transform duration-200",
              isOpen && "rotate-180"
            )}
            style={{ color: "var(--sb-muted)" }}
          />
        </div>
      </button>
      
      {/* Expanded content */}
      {isOpen && currentFilter && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--sb-border)" }}>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Saved filters dropdown */}
            <SavedFilters
              currentFilter={currentFilter}
              onLoad={handleLoadFilter}
              onSave={handleSaveFilter}
              onNew={handleNewFilter}
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
            <div className="p-3 rounded-xl bg-white/50 dark:bg-white/[0.03]">
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
              totalCount={results.length}
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
    </section>
  );
}

// ============================================================================
// Export for use in page
// ============================================================================

export { type TrackDataPoint, type PlaylistDataPoint } from "./filterQuery";
