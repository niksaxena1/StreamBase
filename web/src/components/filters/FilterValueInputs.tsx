"use client";

/**
 * Filter Value Input Components
 * 
 * Dynamic input components based on field type (number, date, text, select, etc.)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Calendar, Check, ChevronDown, Music, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { foldForSearch } from "@/lib/searchFold";
import type { FilterFieldDefinition, FilterOperator, FilterValue } from "./filterTypes";
import { MONTH_OPTIONS, parseNumberValue, formatNumberValue } from "./filterConfig";

// ============================================================================
// Shared Styles
// ============================================================================

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ============================================================================
// Number Input
// ============================================================================

type NumberInputProps = {
  value: FilterValue;
  operator: FilterOperator;
  fieldDef: FilterFieldDefinition;
  onChange: (value: FilterValue) => void;
};

export function NumberInput({ value, operator, fieldDef, onChange }: NumberInputProps) {
  const isBetween = operator === "between";
  
  // Handle "between" operator with min/max object
  if (isBetween) {
    const rangeValue = (value && typeof value === "object" && "min" in value)
      ? value as { min: number; max: number }
      : { min: 0, max: 0 };
    
    return (
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 w-full lg:w-auto">
        <NumberSingleInput
          value={rangeValue.min}
          placeholder={fieldDef.placeholder ?? "Min"}
          onChange={(n) => onChange({ ...rangeValue, min: n ?? 0 })}
        />
        <span className="text-xs hidden lg:block" style={{ color: "var(--sb-muted)" }}>and</span>
        <NumberSingleInput
          value={rangeValue.max}
          placeholder="Max"
          onChange={(n) => onChange({ ...rangeValue, max: n ?? 0 })}
        />
      </div>
    );
  }
  
  // Single number input
  const numValue = typeof value === "number" ? value : null;
  
  return (
    <NumberSingleInput
      value={numValue}
      placeholder={fieldDef.placeholder}
      onChange={(n) => onChange(n)}
    />
  );
}

function NumberSingleInput({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  const [inputValue, setInputValue] = useState(() => 
    value != null ? formatNumberValue(value) : ""
  );
  
  // Sync external value changes
  useEffect(() => {
    if (value != null) {
      const current = parseNumberValue(inputValue);
      if (current !== value) {
        setInputValue(formatNumberValue(value));
      }
    } else if (inputValue && !parseNumberValue(inputValue)) {
      // Keep invalid input as-is for user to fix
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleBlur() {
    const parsed = parseNumberValue(inputValue);
    if (parsed !== null) {
      setInputValue(formatNumberValue(parsed));
      onChange(parsed);
    } else if (!inputValue.trim()) {
      onChange(null);
    }
  }

  return (
    <Input
      type="text"
      value={inputValue}
      placeholder={placeholder ?? "Enter number..."}
      onChange={(e) => {
        setInputValue(e.target.value);
        // Live update if valid
        const parsed = parseNumberValue(e.target.value);
        if (parsed !== null) {
          onChange(parsed);
        }
      }}
      onBlur={handleBlur}
      className="w-full lg:min-w-[100px] lg:max-w-[140px]"
    />
  );
}

// ============================================================================
// Date Input
// ============================================================================

type DateInputProps = {
  value: FilterValue;
  operator: FilterOperator;
  fieldDef: FilterFieldDefinition;
  onChange: (value: FilterValue) => void;
};

export function DateInput({ value, operator, fieldDef, onChange }: DateInputProps) {
  // Month selector for month_is operator
  if (operator === "month_is") {
    const monthValue = typeof value === "string" ? value : "";
    const monthOptions: ComboboxOption[] = MONTH_OPTIONS.map((m) => ({ value: m.value, label: m.label }));
    return (
      <div className="sb-ring w-full lg:min-w-[180px] lg:max-w-[220px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
        <Combobox
          value={monthValue || null}
          options={monthOptions}
          placeholder="Select month…"
          ariaLabel="Select month"
          onChange={(v) => onChange(v)}
          showThumbnails={false}
        />
      </div>
    );
  }
  
  // Year input for year_is operator
  if (operator === "year_is") {
    const yearValue = typeof value === "string" ? value : "";
    const currentYear = new Date().getFullYear();
    const years = Array.from({ length: 30 }, (_, i) => currentYear - i);
    const yearOptions: ComboboxOption[] = years.map((y) => ({ value: String(y), label: String(y) }));
    
    return (
      <div className="sb-ring w-full lg:min-w-[140px] lg:max-w-[180px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
        <Combobox
          value={yearValue || null}
          options={yearOptions}
          placeholder="Select year…"
          ariaLabel="Select year"
          onChange={(v) => onChange(v)}
          showThumbnails={false}
        />
      </div>
    );
  }
  
  // Date range for "between" operator
  if (operator === "between") {
    const rangeValue = (value && typeof value === "object" && "start" in value)
      ? value as { start: string; end: string }
      : { start: "", end: "" };
    
    return (
      <div className="flex flex-col lg:flex-row lg:items-center gap-2 w-full lg:w-auto">
        <DateSingleInput
          value={rangeValue.start}
          placeholder="Start date"
          onChange={(d) => onChange({ ...rangeValue, start: d })}
        />
        <span className="text-xs hidden lg:block" style={{ color: "var(--sb-muted)" }}>and</span>
        <DateSingleInput
          value={rangeValue.end}
          placeholder="End date"
          onChange={(d) => onChange({ ...rangeValue, end: d })}
        />
      </div>
    );
  }
  
  // Single date input
  const dateValue = typeof value === "string" ? value : "";
  
  return (
    <DateSingleInput
      value={dateValue}
      placeholder={fieldDef.placeholder}
      onChange={onChange}
    />
  );
}

function DateSingleInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-full lg:w-auto">
      <Input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full lg:min-w-[140px] lg:max-w-[160px] pr-8"
        style={{ colorScheme: "light dark" }}
      />
      <Calendar 
        className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none opacity-40" 
      />
    </div>
  );
}

// ============================================================================
// Text Input
// ============================================================================

type TextInputProps = {
  value: FilterValue;
  operator: FilterOperator;
  fieldDef: FilterFieldDefinition;
  onChange: (value: FilterValue) => void;
};

export function TextInput({ value, fieldDef, onChange }: TextInputProps) {
  const textValue = typeof value === "string" ? value : "";
  
  return (
    <Input
      type="text"
      value={textValue}
      placeholder={fieldDef.placeholder ?? "Enter text..."}
      onChange={(e) => onChange(e.target.value)}
      className="w-full lg:min-w-[160px] lg:max-w-[240px]"
    />
  );
}

// ============================================================================
// Select Input (single)
// ============================================================================

type SelectInputProps = {
  value: FilterValue;
  operator: FilterOperator;
  fieldDef: FilterFieldDefinition;
  options: Array<{ value: string; label: string; imageUrl?: string | null }>;
  onChange: (value: FilterValue) => void;
};

export function SelectInput({ value, fieldDef, options, onChange }: SelectInputProps) {
  const selectValue = typeof value === "string" ? value : "";
  const comboOptions: ComboboxOption[] = (options ?? []).map((o) => ({ value: o.value, label: o.label }));
  
  return (
    <div className="sb-ring w-full lg:min-w-[200px] lg:max-w-[280px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
      <Combobox
        value={selectValue || null}
        options={comboOptions}
        placeholder={fieldDef.placeholder ?? "Select…"}
        ariaLabel={fieldDef.label}
        onChange={(v) => onChange(v)}
        showThumbnails={false}
      />
    </div>
  );
}

// ============================================================================
// Multi-Select Input (with search)
// ============================================================================

type MultiSelectInputProps = {
  value: FilterValue;
  operator: FilterOperator;
  fieldDef: FilterFieldDefinition;
  options: Array<{ value: string; label: string; imageUrl?: string | null; isAllCatalog?: boolean }>;
  onChange: (value: FilterValue) => void;
  imageShape?: "circle" | "square";
};

export function MultiSelectInput({ value, fieldDef, options, onChange, imageShape = "circle" }: MultiSelectInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Ensure value is an array
  const selectedValues: string[] = Array.isArray(value) ? value : [];
  
  // Get selected option labels (with imageUrl for pill thumbnails)
  const selectedItems = useMemo(() => {
    return selectedValues
      .map(v => {
        const opt = options.find(o => o.value === v);
        return { label: opt?.label ?? v, imageUrl: opt?.imageUrl ?? null, isAllCatalog: opt?.isAllCatalog ?? false };
      })
      .slice(0, 3);
  }, [selectedValues, options]);
  
  const moreCount = selectedValues.length - 3;
  
  // Filter options by search
  const filteredOptions = useMemo(() => {
    const q = foldForSearch(searchQuery);
    if (!q) return options;
    return options.filter(o => foldForSearch(o.label).includes(q));
  }, [options, searchQuery]);
  
  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  
  function toggleOption(optValue: string) {
    if (selectedValues.includes(optValue)) {
      onChange(selectedValues.filter(v => v !== optValue));
    } else {
      onChange([...selectedValues, optValue]);
    }
  }
  
  function removeOption(optValue: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(selectedValues.filter(v => v !== optValue));
  }
  
  function clearAll(e: React.MouseEvent) {
    e.stopPropagation();
    onChange([]);
  }
  
  return (
    <div ref={rootRef} className="relative w-full lg:min-w-[200px] lg:max-w-[360px]">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        className={cx(
          "sb-ring w-full rounded-xl border px-3 py-2 text-sm outline-none transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
          "flex items-center justify-between gap-2 text-left cursor-pointer",
          // Theme-safe hover (uses CSS variables, not `dark:`)
          "hover:bg-[color:var(--sb-card)]"
        )}
        style={{
          backgroundColor: "var(--sb-surface)",
          borderColor: "var(--sb-border)",
          color: "var(--sb-text)",
        }}
      >
        <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden">
          {selectedValues.length === 0 ? (
            <span className="text-sm opacity-70" style={{ color: "var(--sb-muted)" }}>
              {fieldDef.placeholder ?? "Select..."}
            </span>
          ) : (
            <>
              {selectedItems.map((item, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs bg-black/10 dark:bg-white/10 truncate max-w-[140px]"
                >
                  {item.isAllCatalog ? (
                    <span
                      className="h-3.5 w-3.5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--sb-accent)" }}
                    >
                      <Music className="h-2 w-2" style={{ color: "black" }} />
                    </span>
                  ) : item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      width={14}
                      height={14}
                      className={[
                        "h-3.5 w-3.5 object-cover shrink-0",
                        imageShape === "square" ? "rounded-sm" : "rounded-full",
                      ].join(" ")}
                    />
                  ) : null}
                  <span className="truncate">{item.label}</span>
                  <X
                    className="h-3 w-3 shrink-0 cursor-pointer hover:opacity-70"
                    onClick={(e) => removeOption(selectedValues[i], e)}
                  />
                </span>
              ))}
              {moreCount > 0 && (
                <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  +{moreCount} more
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedValues.length > 0 && (
            <X
              className="h-4 w-4 cursor-pointer hover:opacity-70"
              style={{ color: "var(--sb-muted)" }}
              onClick={clearAll}
            />
          )}
          <ChevronDown 
            className={cx(
              "h-4 w-4 transition-transform",
              isOpen && "rotate-180"
            )}
            style={{ color: "var(--sb-muted)" }}
          />
        </div>
      </button>
      
      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[100] max-h-[340px] overflow-auto rounded-2xl border p-1 shadow-lg backdrop-blur-md"
          style={{
            borderColor: "var(--sb-border)",
            backgroundColor: "var(--sb-card)",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
            backdropFilter: "blur(var(--sb-blur))",
          }}
        >
          {/* Search input */}
          <div
            className="sticky top-0 p-2 border-b"
            style={{ borderColor: "var(--sb-border)", backgroundColor: "var(--sb-card)" }}
          >
            <Input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full"
            />
          </div>
          
          {/* Options list */}
          <div className="p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm" style={{ color: "var(--sb-muted)" }}>
                No matches found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedValues.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleOption(opt.value)}
                    className={cx(
                      "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                      isSelected ? "" : "hover:bg-[color:var(--sb-surface)]"
                    )}
                    style={
                      isSelected
                        ? { backgroundColor: "var(--sb-text)", color: "var(--sb-bg)" }
                        : { color: "var(--sb-text)" }
                    }
                    onMouseDown={(e) => {
                      // Keep focus stable
                      e.preventDefault();
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {opt.isAllCatalog ? (
                        <span
                          className={`h-5 w-5 ${imageShape === "square" ? "rounded-lg" : "rounded-full"} flex items-center justify-center shrink-0`}
                          style={{ background: "var(--sb-accent)" }}
                        >
                          <Music className="h-3 w-3" style={{ color: "black" }} />
                        </span>
                      ) : opt.imageUrl ? (
                        <Image
                          src={opt.imageUrl}
                          alt=""
                          width={20}
                          height={20}
                          className={[
                            "h-5 w-5 object-cover shrink-0",
                            imageShape === "square" ? "rounded-lg" : "rounded-full",
                          ].join(" ")}
                        />
                      ) : null}
                      <span className="truncate">{opt.label}</span>
                    </div>
                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} style={{ color: "var(--sb-bg)" }} />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Boolean Input
// ============================================================================

type BooleanInputProps = {
  value: FilterValue;
  fieldDef: FilterFieldDefinition;
  onChange: (value: FilterValue) => void;
};

export function BooleanInput({ value, fieldDef, onChange }: BooleanInputProps) {
  const boolValue = value === true || value === "true" ? "true" : value === false || value === "false" ? "false" : "";
  const options = fieldDef.options ?? [
    { value: "true", label: "Yes" },
    { value: "false", label: "No" },
  ];
  const boolOptions: ComboboxOption[] = options.map((o) => ({ value: o.value, label: o.label }));
  
  return (
    <div className="sb-ring min-w-[140px] max-w-[180px] rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
      <Combobox
        value={boolValue || null}
        options={boolOptions}
        placeholder="Select…"
        ariaLabel={fieldDef.label}
        onChange={(v) => onChange(v)}
        showThumbnails={false}
      />
    </div>
  );
}

// ============================================================================
// Main Value Input Component
// ============================================================================

type FilterValueInputProps = {
  value: FilterValue;
  operator: FilterOperator;
  fieldDef: FilterFieldDefinition;
  options?: Array<{ value: string; label: string; imageUrl?: string | null }>;
  onChange: (value: FilterValue) => void;
};

export function FilterValueInput({ value, operator, fieldDef, options = [], onChange }: FilterValueInputProps) {
  switch (fieldDef.type) {
    case "number":
      return <NumberInput value={value} operator={operator} fieldDef={fieldDef} onChange={onChange} />;
    
    case "date":
      return <DateInput value={value} operator={operator} fieldDef={fieldDef} onChange={onChange} />;
    
    case "text":
      return <TextInput value={value} operator={operator} fieldDef={fieldDef} onChange={onChange} />;
    
    case "select":
      if (operator === "in" || operator === "not_in") {
        return (
          <MultiSelectInput
            value={value}
            operator={operator}
            fieldDef={fieldDef}
            options={options}
            onChange={onChange}
          />
        );
      }
      return <SelectInput value={value} operator={operator} fieldDef={fieldDef} options={options} onChange={onChange} />;
    
    case "multi-select":
      return (
        <MultiSelectInput
          value={value}
          operator={operator}
          fieldDef={fieldDef}
          options={options}
          onChange={onChange}
          imageShape={fieldDef.key === "playlist" || fieldDef.key === "contains_track" ? "square" : "circle"}
        />
      );
    
    case "boolean":
      return <BooleanInput value={value} fieldDef={fieldDef} onChange={onChange} />;
    
    default:
      return <TextInput value={value} operator={operator} fieldDef={fieldDef} onChange={onChange} />;
  }
}
