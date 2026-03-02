"use client";

/**
 * Saved Filters Component
 *
 * Dropdown to load, save, delete, and manage saved filters.
 * Filters are persisted server-side (Supabase) so they sync across devices.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  Copy,
  Download,
  Loader2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { FilterConfig } from "./filterTypes";
import { ENTITY_CONFIGS } from "./filterConfig";
import {
  loadSavedFilters,
  saveFilter,
  deleteFilter,
  duplicateFilter,
  exportFilterAsJson,
  importFilterFromJson,
} from "./filterStorage";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

type SavedFiltersProps = {
  currentFilter: FilterConfig | null;
  onLoad: (filter: FilterConfig) => void;
  onSave: (filter: FilterConfig) => void;
};

export function SavedFilters({ currentFilter, onLoad, onSave }: SavedFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [savedFilters, setSavedFilters] = useState<FilterConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshFilters = useCallback(async () => {
    setLoading(true);
    const filters = await loadSavedFilters();
    setSavedFilters(filters);
    setLoading(false);
  }, []);

  // Load saved filters on mount and when dropdown opens
  useEffect(() => {
    if (isOpen) {
      refreshFilters();
    }
  }, [isOpen, refreshFilters]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleLoadFilter(filter: FilterConfig) {
    onLoad(filter);
    setIsOpen(false);
  }

  async function handleSaveClick() {
    if (!currentFilter) return;

    if (!currentFilter.name) {
      setSaveAsName("");
      setSaveModalOpen(true);
    } else {
      setSaving(true);
      const saved = await saveFilter(currentFilter);
      setSaving(false);
      if (saved) onSave(saved);
    }
  }

  async function handleSaveAs() {
    if (!currentFilter || !saveAsName.trim()) return;

    const toSave: FilterConfig = {
      ...currentFilter,
      name: saveAsName.trim(),
    };

    setSaving(true);
    const saved = await saveFilter(toSave);
    setSaving(false);

    if (saved) {
      onSave(saved);
      setSaveModalOpen(false);
      setSaveAsName("");
    }
  }

  async function handleDuplicate(filterId: string) {
    const dup = await duplicateFilter(filterId, savedFilters);
    if (dup) {
      await refreshFilters();
    }
  }

  async function handleDelete(filterId: string) {
    await deleteFilter(filterId);
    setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));
    setDeleteConfirmId(null);
  }

  function handleExport(filter: FilterConfig) {
    const json = exportFilterAsJson(filter);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `filter-${filter.name || filter.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImport() {
    setImportError(null);
    const filter = importFilterFromJson(importJson);

    if (!filter) {
      setImportError("Invalid filter JSON. Please check the format.");
      return;
    }

    setSaving(true);
    const saved = await saveFilter(filter);
    setSaving(false);

    if (saved) {
      onLoad(saved);
      setImportModalOpen(false);
      setImportJson("");
    } else {
      setImportError("Failed to save the imported filter.");
    }
  }

  const hasUnsavedChanges = currentFilter && !currentFilter.name;

  return (
    <div ref={rootRef} className="relative">
      {/* Trigger button */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Bookmark className="h-4 w-4" />}
          rightIcon={
            <ChevronDown
              className={cx(
                "h-3 w-3 transition-transform",
                isOpen && "rotate-180",
              )}
            />
          }
          onClick={() => setIsOpen(!isOpen)}
        >
          {currentFilter?.name || "Saved Filters"}
        </Button>

        {/* Quick save button */}
        {currentFilter && (
          <IconButton
            aria-label="Save filter"
            onClick={handleSaveClick}
            title={hasUnsavedChanges ? "Save as..." : "Save changes"}
            className={hasUnsavedChanges ? "text-[var(--sb-accent)]" : undefined}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
          </IconButton>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[320px] max-h-[400px] overflow-auto rounded-2xl border shadow-xl"
          style={{
            borderColor: "var(--sb-border)",
            backgroundColor: "var(--sb-card)",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
            backdropFilter: "blur(var(--sb-blur))",
          }}
        >
          {/* Saved filters */}
          <div className="p-2">
            <div
              className="text-xs font-medium mb-2 px-2"
              style={{ color: "var(--sb-muted)" }}
            >
              Saved Filters ({savedFilters.length})
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2
                  className="h-5 w-5 animate-spin"
                  style={{ color: "var(--sb-muted)" }}
                />
              </div>
            ) : savedFilters.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-sm"
                style={{ color: "var(--sb-muted)" }}
              >
                No saved filters yet.
                <br />
                Build a filter and save it for reuse.
              </div>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-auto">
                {savedFilters.map((filter) => (
                  <FilterListItem
                    key={filter.id}
                    filter={filter}
                    isActive={currentFilter?.id === filter.id}
                    onLoad={() => handleLoadFilter(filter)}
                    onDuplicate={() => handleDuplicate(filter.id)}
                    onExport={() => handleExport(filter)}
                    onDelete={() => setDeleteConfirmId(filter.id)}
                    deleteConfirmId={deleteConfirmId}
                    onDeleteConfirm={() => handleDelete(filter.id)}
                    onDeleteCancel={() => setDeleteConfirmId(null)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Import button */}
          <div
            className="p-2 border-t"
            style={{ borderColor: "var(--sb-border)" }}
          >
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Upload className="h-4 w-4" />}
              onClick={() => {
                setImportJson("");
                setImportError(null);
                setImportModalOpen(true);
              }}
              className="w-full justify-start"
            >
              Import from JSON
            </Button>
          </div>
        </div>
      )}

      {/* Save As Modal */}
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save Filter"
      >
        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: "var(--sb-text)" }}
            >
              Filter Name
            </label>
            <Input
              type="text"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              placeholder="e.g., Top performers Jan 2026"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setSaveModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveAs}
              disabled={!saveAsName.trim() || saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Import Modal */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import Filter"
      >
        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: "var(--sb-text)" }}
            >
              Paste filter JSON
            </label>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder='{"entityType": "tracks", "groups": [...], ...}'
              className="w-full h-32 rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40 resize-none font-mono"
              style={{ color: "var(--sb-text)" }}
            />
            {importError && (
              <p className="mt-2 text-sm text-red-500">{importError}</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setImportModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={!importJson.trim() || saving}
            >
              {saving ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================================
// Filter List Item
// ============================================================================

function FilterListItem({
  filter,
  isActive,
  onLoad,
  onDuplicate,
  onExport,
  onDelete,
  deleteConfirmId,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  filter: FilterConfig;
  isActive: boolean;
  onLoad: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  deleteConfirmId: string | null;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const isDeleting = deleteConfirmId === filter.id;
  const entityConfig = ENTITY_CONFIGS[filter.entityType];
  const conditionCount = filter.groups.reduce(
    (acc, g) => acc + g.conditions.filter((c) => c.enabled && c.field).length,
    0,
  );

  if (isDeleting) {
    return (
      <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-red-500/10">
        <span className="text-sm">Delete &ldquo;{filter.name}&rdquo;?</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onDeleteCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onDeleteConfirm}>
            Delete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        "group flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition",
        isActive
          ? "bg-[var(--sb-accent)]/20"
          : "hover:bg-[color:var(--sb-surface)]",
      )}
      onClick={onLoad}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="font-medium text-sm truncate"
            style={{ color: "var(--sb-text)" }}
          >
            {filter.name || "Untitled"}
          </span>
          {isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--sb-accent)] text-black">
              Active
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-2 text-xs"
          style={{ color: "var(--sb-muted)" }}
        >
          <span>{entityConfig?.label ?? filter.entityType}</span>
          <span>&bull;</span>
          <span>
            {conditionCount} condition{conditionCount !== 1 ? "s" : ""}
          </span>
          <span>&bull;</span>
          <span>{formatRelativeTime(filter.updatedAt)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <IconButton
          aria-label="Duplicate"
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          title="Duplicate"
        >
          <Copy className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          aria-label="Export"
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
          title="Export as JSON"
        >
          <Download className="h-3.5 w-3.5" />
        </IconButton>
        <IconButton
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          className="hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}
