"use client";

/**
 * Filter Condition Component
 * 
 * A single condition row: Field selector -> Operator selector -> Value input
 */

import { Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { IconButton } from "@/components/ui/Button";
import type { FilterCondition as FilterConditionType, FilterOperator, FilterValue, EntityType } from "./filterTypes";
import { 
  getFieldsForEntity, 
  getFieldDefinition, 
  getDefaultOperator, 
  getOperatorLabel 
} from "./filterConfig";
import { FilterValueInput } from "./FilterValueInputs";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type FilterConditionProps = {
  condition: FilterConditionType;
  entityType: EntityType;
  dynamicOptions: Record<string, Array<{ value: string; label: string; imageUrl?: string | null; isAllCatalog?: boolean }>>;
  onChange: (condition: FilterConditionType) => void;
  onRemove: () => void;
  canRemove: boolean;
};

export function FilterCondition({
  condition,
  entityType,
  dynamicOptions,
  onChange,
  onRemove,
  canRemove,
}: FilterConditionProps) {
  const fields = getFieldsForEntity(entityType);
  const fieldDef = condition.field ? getFieldDefinition(entityType, condition.field) : undefined;

  const fieldOptionsForCombobox: ComboboxOption[] = fields.map((f) => ({
    value: f.key,
    label: f.label,
  }));
  
  // Get options for this field (either static or dynamic)
  const fieldOptions = fieldDef?.options ?? (
    fieldDef?.optionsSource
      ? dynamicOptions[`${entityType}.${fieldDef.key}`] ?? dynamicOptions[fieldDef.optionsSource] ?? []
      : []
  );

  const operatorOptionsForCombobox: ComboboxOption[] = (fieldDef?.operators ?? []).map((op) => ({
    value: String(op),
    label: getOperatorLabel(op, fieldDef?.type ?? "text"),
  }));
  const showOperatorSelector = operatorOptionsForCombobox.length > 1;
  
  function handleFieldChange(newField: string) {
    const newFieldDef = getFieldDefinition(entityType, newField);
    const newOperator = newFieldDef ? getDefaultOperator(newFieldDef) : "eq";
    
    // Reset value when field changes (type may be different)
    onChange({
      ...condition,
      field: newField,
      operator: newOperator as FilterOperator,
      value: null,
    });
  }
  
  function handleOperatorChange(newOperator: string) {
    // Reset value if switching to/from "between" (different value shape)
    const wasBetween = condition.operator === "between";
    const isBetween = newOperator === "between";
    const needsReset = wasBetween !== isBetween;
    
    onChange({
      ...condition,
      operator: newOperator as FilterOperator,
      value: needsReset ? null : condition.value,
    });
  }
  
  function handleValueChange(newValue: FilterValue) {
    onChange({
      ...condition,
      value: newValue,
    });
  }
  
  function handleToggleEnabled() {
    onChange({
      ...condition,
      enabled: !condition.enabled,
    });
  }
  
  return (
    <div
      className={cx(
        "group flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-2 p-2 rounded-xl transition",
        "sb-panel sb-panel-hover",
        !condition.enabled && "opacity-50"
      )}
    >
      {/* Field selector */}
      <div className="sb-ring w-full lg:min-w-[180px] lg:max-w-[220px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
        <Combobox
          value={condition.field || null}
          options={fieldOptionsForCombobox}
          placeholder="Select field…"
          ariaLabel="Select field"
          onChange={handleFieldChange}
          showThumbnails={false}
        />
      </div>
      
      {/* Operator selector (only show if there is a real choice) */}
      {fieldDef && showOperatorSelector && (
        <div className="sb-ring w-full lg:min-w-[160px] lg:max-w-[200px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
          <Combobox
            value={condition.operator}
            options={operatorOptionsForCombobox}
            placeholder="Operator…"
            ariaLabel="Select operator"
            onChange={handleOperatorChange}
            showThumbnails={false}
          />
        </div>
      )}
      
      {/* Value input (only show if field is selected) */}
      {fieldDef && (
        <FilterValueInput
          value={condition.value}
          operator={condition.operator}
          fieldDef={fieldDef}
          options={fieldOptions}
          onChange={handleValueChange}
        />
      )}
      
      {/* Spacer */}
      <div className="hidden lg:flex-1 lg:block" />
      
      {/* Toggle enabled/disabled and Remove button */}
      <div className="flex items-center gap-2 lg:gap-0">
        <IconButton
          aria-label={condition.enabled ? "Disable condition" : "Enable condition"}
          onClick={handleToggleEnabled}
          className="opacity-50 hover:opacity-100"
          title={condition.enabled ? "Click to disable" : "Click to enable"}
        >
          {condition.enabled ? (
            <ToggleRight className="h-4 w-4" style={{ color: "var(--sb-positive)" }} />
          ) : (
            <ToggleLeft className="h-4 w-4" />
          )}
        </IconButton>
        
        {/* Remove button */}
        <IconButton
          aria-label="Remove condition"
          onClick={onRemove}
          disabled={!canRemove}
          className={cx(
            "opacity-0 group-hover:opacity-50 hover:!opacity-100 transition",
            !canRemove && "!opacity-0 cursor-not-allowed"
          )}
          title="Remove condition"
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

// ============================================================================
// Condition Summary (for display when collapsed)
// ============================================================================

export function ConditionSummary({
  condition,
  entityType,
  dynamicOptions,
}: {
  condition: FilterConditionType;
  entityType: EntityType;
  dynamicOptions: Record<string, Array<{ value: string; label: string }>>;
}) {
  const fieldDef = condition.field ? getFieldDefinition(entityType, condition.field) : undefined;
  if (!fieldDef) return null;
  
  const operatorLabel = getOperatorLabel(condition.operator, fieldDef.type);
  const showOperatorLabel = fieldDef.operators.length > 1;
  
  // Format value for display
  let valueLabel = "";
  if (condition.value === null || condition.value === "") {
    valueLabel = "(not set)";
  } else if (typeof condition.value === "object" && "min" in condition.value) {
    const { min, max } = condition.value as { min: number; max: number };
    valueLabel = `${min.toLocaleString()} - ${max.toLocaleString()}`;
  } else if (typeof condition.value === "object" && "start" in condition.value) {
    const { start, end } = condition.value as { start: string; end: string };
    valueLabel = `${start} - ${end}`;
  } else if (Array.isArray(condition.value)) {
    // Multi-select: show labels
    const opts = fieldDef.options ?? (
      fieldDef.optionsSource
        ? dynamicOptions[`${entityType}.${fieldDef.key}`] ?? dynamicOptions[fieldDef.optionsSource] ?? []
        : []
    );
    const labels = condition.value
      .map(v => opts.find(o => o.value === v)?.label ?? v)
      .slice(0, 2);
    const more = condition.value.length - 2;
    valueLabel = labels.join(", ") + (more > 0 ? ` +${more}` : "");
  } else if (condition.operator === "last_n_days") {
    valueLabel = `${condition.value} days`;
  } else {
    valueLabel = String(condition.value);
  }

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg",
        "bg-black/5 dark:bg-white/10",
        !condition.enabled && "opacity-50 line-through"
      )}
    >
      <span className="font-medium">{fieldDef.label}</span>
      {showOperatorLabel && <span style={{ color: "var(--sb-muted)" }}>{operatorLabel}</span>}
      <span className="font-medium">{valueLabel}</span>
    </span>
  );
}
