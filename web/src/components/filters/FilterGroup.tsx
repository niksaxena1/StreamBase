"use client";

/**
 * Filter Group Component
 * 
 * A group of conditions with AND/OR logic toggle
 */

import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import type { 
  FilterGroup as FilterGroupType, 
  FilterCondition as FilterConditionType,
  FilterGroupLogic,
  EntityType,
} from "./filterTypes";
import { createEmptyCondition } from "./filterTypes";
import { FilterCondition, ConditionSummary } from "./FilterCondition";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type FilterGroupProps = {
  group: FilterGroupType;
  entityType: EntityType;
  dynamicOptions: Record<string, Array<{ value: string; label: string; imageUrl?: string | null }>>;
  groupIndex: number;
  totalGroups: number;
  onChange: (group: FilterGroupType) => void;
  onRemove: () => void;
};

export function FilterGroup({
  group,
  entityType,
  dynamicOptions,
  groupIndex,
  totalGroups,
  onChange,
  onRemove,
}: FilterGroupProps) {
  const canRemoveGroup = totalGroups > 1;
  const canRemoveCondition = group.conditions.length > 1;
  
  function handleLogicChange(logic: FilterGroupLogic) {
    onChange({ ...group, logic });
  }
  
  function handleConditionChange(index: number, condition: FilterConditionType) {
    const newConditions = [...group.conditions];
    newConditions[index] = condition;
    onChange({ ...group, conditions: newConditions });
  }
  
  function handleConditionRemove(index: number) {
    if (!canRemoveCondition) return;
    const newConditions = group.conditions.filter((_, i) => i !== index);
    onChange({ ...group, conditions: newConditions });
  }
  
  function handleAddCondition() {
    onChange({
      ...group,
      conditions: [...group.conditions, createEmptyCondition()],
    });
  }
  
  // Count active/valid conditions
  const activeConditions = group.conditions.filter(c => c.enabled && c.field);
  
  return (
    <div
      className={cx(
        "relative rounded-2xl border p-4 transition sb-panel"
      )}
      style={{ borderColor: "var(--sb-border)" }}
    >
      {/* Group header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Group index label */}
          <span className="text-xs font-medium px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10">
            Group {groupIndex + 1}
          </span>
          
          {/* Logic toggle */}
          <div className="flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "var(--sb-border)" }}>
            <button
              type="button"
              onClick={() => handleLogicChange("AND")}
              className={cx(
                "px-3 py-2 min-h-[36px] text-xs font-medium transition",
                group.logic === "AND"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
              )}
              style={group.logic !== "AND" ? { color: "var(--sb-muted)" } : undefined}
            >
              AND
            </button>
            <button
              type="button"
              onClick={() => handleLogicChange("OR")}
              className={cx(
                "px-3 py-2 min-h-[36px] text-xs font-medium transition",
                group.logic === "OR"
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-transparent hover:bg-black/5 dark:hover:bg-white/10"
              )}
              style={group.logic !== "OR" ? { color: "var(--sb-muted)" } : undefined}
            >
              OR
            </button>
          </div>
          
          {/* Active conditions count */}
          <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
            {activeConditions.length} active condition{activeConditions.length !== 1 ? "s" : ""}
          </span>
        </div>
        
        {/* Remove group button */}
        <IconButton
          aria-label="Remove group"
          onClick={onRemove}
          disabled={!canRemoveGroup}
          className={cx(
            "opacity-50 hover:opacity-100 transition",
            !canRemoveGroup && "!opacity-0 cursor-not-allowed"
          )}
          title={canRemoveGroup ? "Remove group" : "Cannot remove last group"}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
      
      {/* Conditions */}
      <div className="space-y-2">
        {group.conditions.map((condition, index) => (
          <div key={condition.id}>
            {/* Show AND/OR connector between conditions */}
            {index > 0 && (
              <div className="flex items-center gap-2 py-1 px-2">
                <div className="flex-1 h-px" style={{ background: "var(--sb-border)" }} />
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded"
                  style={{ 
                    color: "var(--sb-muted)",
                    background: group.logic === "OR" ? "rgba(var(--sb-accent-rgb), 0.1)" : "transparent",
                  }}
                >
                  {group.logic}
                </span>
                <div className="flex-1 h-px" style={{ background: "var(--sb-border)" }} />
              </div>
            )}
            
            <FilterCondition
              condition={condition}
              entityType={entityType}
              dynamicOptions={dynamicOptions}
              onChange={(c) => handleConditionChange(index, c)}
              onRemove={() => handleConditionRemove(index)}
              canRemove={canRemoveCondition}
            />
          </div>
        ))}
      </div>
      
      {/* Add condition button */}
      <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--sb-border)" }}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={handleAddCondition}
        >
          Add condition
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Group Summary (for collapsed view)
// ============================================================================

export function GroupSummary({
  group,
  entityType,
  dynamicOptions,
}: {
  group: FilterGroupType;
  entityType: EntityType;
  dynamicOptions: Record<string, Array<{ value: string; label: string }>>;
}) {
  const activeConditions = group.conditions.filter(c => c.enabled && c.field);
  
  if (activeConditions.length === 0) {
    return (
      <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
        (no active conditions)
      </span>
    );
  }
  
  return (
    <div className="flex flex-wrap items-center gap-1">
      {activeConditions.map((condition, index) => (
        <span key={condition.id} className="flex items-center gap-1">
          {index > 0 && (
            <span
              className="text-[10px] font-medium px-1"
              style={{ color: "var(--sb-muted)" }}
            >
              {group.logic}
            </span>
          )}
          <ConditionSummary
            condition={condition}
            entityType={entityType}
            dynamicOptions={dynamicOptions}
          />
        </span>
      ))}
    </div>
  );
}
