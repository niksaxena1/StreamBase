"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Bookmark, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { FilterGroup } from "@/components/filters/FilterGroup";
import type {
  FilterConfig,
  FilterGroup as FilterGroupType,
  FilterGroupJoinLogic,
} from "@/components/filters/filterTypes";
import {
  createEmptyFilter,
  createEmptyGroup,
} from "@/components/filters/filterTypes";
import {
  hasActiveConditions,
  countActiveConditions,
} from "@/components/filters/filterQuery";
import type { GraphNode } from "./page";

const LS_SAVED = "sb:network:adv-filter-presets:v1";

type SavedPreset = { id: string; name: string; createdAt: string; config: FilterConfig };

function readPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(LS_SAVED);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    const out: SavedPreset[] = [];
    for (const x of j) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.name !== "string" || !o.config) continue;
      out.push({
        id: o.id,
        name: o.name,
        createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
        config: o.config as FilterConfig,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function writePresets(presets: SavedPreset[]) {
  try {
    localStorage.setItem(LS_SAVED, JSON.stringify(presets.slice(0, 30)));
  } catch {
    // ignore
  }
}

function cloneFilter(f: FilterConfig): FilterConfig {
  return JSON.parse(JSON.stringify(f)) as FilterConfig;
}

type Props = {
  open: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  appliedFilter: FilterConfig | null;
  onApply: (filter: FilterConfig) => void;
  onClearAdvanced: () => void;
};

export function NetworkAdvancedFilterModal({
  open,
  onClose,
  nodes,
  appliedFilter,
  onApply,
  onClearAdvanced,
}: Props) {
  const [draft, setDraft] = useState<FilterConfig>(() => createEmptyFilter("network_artists"));
  const [presetTick, setPresetTick] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- sync draft when modal opens */
  useEffect(() => {
    if (!open) return;
    if (appliedFilter && hasActiveConditions(appliedFilter)) {
      setDraft(cloneFilter(appliedFilter));
    } else {
      setDraft(createEmptyFilter("network_artists"));
    }
  }, [open, appliedFilter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dynamicOptions = useMemo(
    () => ({
      network_nodes: nodes.map((n) => ({
        value: n.id,
        label: n.name,
        imageUrl: n.image_url,
      })),
    }),
    [nodes],
  );

  void presetTick;
  const presets = readPresets();

  const handleGroupChange = useCallback((index: number, group: FilterGroupType) => {
    setDraft((prev) => {
      const newGroups = [...prev.groups];
      newGroups[index] = group;
      return { ...prev, groups: newGroups, updatedAt: new Date().toISOString() };
    });
  }, []);

  const handleGroupRemove = useCallback((index: number) => {
    setDraft((prev) => {
      if (prev.groups.length <= 1) return prev;
      return {
        ...prev,
        groups: prev.groups.filter((_, i) => i !== index),
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const handleAddGroup = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      groups: [...prev.groups, createEmptyGroup()],
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const setGroupJoinLogic = useCallback((logic: FilterGroupJoinLogic) => {
    setDraft((prev) => ({
      ...prev,
      groupJoinLogic: logic,
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const handleResetDraft = useCallback(() => {
    setDraft(createEmptyFilter("network_artists"));
  }, []);

  const handleApply = useCallback(() => {
    if (!hasActiveConditions(draft)) return;
    onApply(cloneFilter(draft));
    onClose();
  }, [draft, onApply, onClose]);

  const handleClearApplied = useCallback(() => {
    onClearAdvanced();
    handleResetDraft();
    onClose();
  }, [onClearAdvanced, handleResetDraft, onClose]);

  const savePreset = useCallback(() => {
    const name = window.prompt("Preset name")?.trim();
    if (!name) return;
    const list = readPresets();
    list.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: new Date().toISOString(),
      config: cloneFilter(draft),
    });
    writePresets(list);
    setPresetTick((t) => t + 1);
  }, [draft]);

  const activeCount = countActiveConditions(draft);
  const appliedCount = appliedFilter && hasActiveConditions(appliedFilter) ? countActiveConditions(appliedFilter) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Advanced artist filters"
      subtitle="Each group has its own AND/OR between conditions. Use “Combine groups” when you add more than one group. Graph fields are local; stream conditions fetch when applied. Presets are stored on this device only."
      maxWidthClassName="max-w-3xl"
    >
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs" style={{ color: "var(--sb-muted)" }}>
        <span>
          {nodes.length.toLocaleString()} artists in graph · {activeCount} condition
          {activeCount !== 1 ? "s" : ""} in editor
          {appliedCount > 0 ? ` · ${appliedCount} applied` : ""}
        </span>
        <div className="flex-1" />
        <select
          aria-label="Load saved preset"
          className="rounded-lg border px-2 py-1.5 text-[11px] outline-none max-w-[11rem]"
          style={{
            borderColor: "var(--sb-border)",
            backgroundColor: "var(--sb-card)",
            color: "var(--sb-text)",
          }}
          value=""
          onChange={(e) => {
            const id = e.target.value;
            e.target.value = "";
            if (!id) return;
            const p = readPresets().find((x) => x.id === id);
            if (p?.config?.entityType === "network_artists") {
              setDraft(cloneFilter(p.config));
            }
          }}
        >
          <option value="">Load preset…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" leftIcon={<Bookmark className="h-3.5 w-3.5" />} onClick={savePreset}>
          Save preset
        </Button>
        <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={handleResetDraft}>
          Reset editor
        </Button>
      </div>

      {draft.groups.length > 1 ? (
        <div
          className="flex flex-wrap items-center gap-2 mb-3 text-[11px] rounded-lg px-2 py-1.5"
          style={{
            backgroundColor: "var(--sb-card)",
            border: "1px solid var(--sb-border)",
            color: "var(--sb-muted)",
          }}
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
                  (draft.groupJoinLogic ?? "AND") === "AND" ? "var(--sb-accent)" : "transparent",
                color: (draft.groupJoinLogic ?? "AND") === "AND" ? "black" : "var(--sb-muted)",
              }}
              onClick={() => setGroupJoinLogic("AND")}
            >
              AND
            </button>
            <button
              type="button"
              className="px-2.5 py-1 font-medium transition-colors border-l"
              aria-label="Combine groups with OR"
              style={{
                borderColor: "var(--sb-border)",
                backgroundColor: draft.groupJoinLogic === "OR" ? "var(--sb-accent)" : "transparent",
                color: draft.groupJoinLogic === "OR" ? "black" : "var(--sb-muted)",
              }}
              onClick={() => setGroupJoinLogic("OR")}
            >
              OR
            </button>
          </div>
          <span className="min-w-0 opacity-90">
            {(draft.groupJoinLogic ?? "AND") === "AND"
              ? "Every group must match."
              : "Match if any group matches."}
          </span>
        </div>
      ) : null}

      <div className="space-y-4 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
        {draft.groups.map((group, index) => (
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
                  {(draft.groupJoinLogic ?? "AND") === "OR" ? "OR" : "AND"}
                </span>
                <div className="flex-1 h-px" style={{ background: "var(--sb-border)" }} />
              </div>
            )}
            <FilterGroup
              group={group}
              entityType="network_artists"
              dynamicOptions={dynamicOptions}
              groupIndex={index}
              totalGroups={draft.groups.length}
              onChange={(g) => handleGroupChange(index, g)}
              onRemove={() => handleGroupRemove(index)}
            />
          </div>
        ))}

        <div className="flex justify-center pt-1">
          <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={handleAddGroup}>
            Add group
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 mt-6 pt-4 border-t" style={{ borderColor: "var(--sb-border)" }}>
        <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="h-4 w-4" />} onClick={handleClearApplied}>
          Clear applied filter
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleApply} disabled={!hasActiveConditions(draft)}>
          Apply to graph
        </Button>
      </div>
    </Modal>
  );
}
