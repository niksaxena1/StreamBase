"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";

export type ComboboxOption = {
  value: string;
  label: string;
};

export function Combobox(props: {
  value: string | null;
  options: ComboboxOption[];
  placeholder?: string;
  ariaLabel: string;
  onChange: (nextValue: string) => void;
  className?: string;
}) {
  const listId = useId();
  const selectedLabel =
    props.options.find((o) => o.value === props.value)?.label ?? "";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedLabel);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setQuery(selectedLabel);
  }, [selectedLabel]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const filtered = useMemo(() => {
    // UX: when focusing a selected value, show full list (not just the exact match)
    const effectiveQuery =
      open && query.trim() === selectedLabel.trim() ? "" : query;
    const q = effectiveQuery.trim().toLowerCase();
    if (!q) return props.options; // Show all options when no search query
    return props.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [open, props.options, query, selectedLabel]);

  function commitIfExact() {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const exact = props.options.find((o) => o.label.toLowerCase() === q);
    if (exact) props.onChange(exact.value);
  }

  return (
    <div ref={rootRef} className={["relative", props.className].filter(Boolean).join(" ")}>
      <input
        ref={inputRef}
        value={query}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="w-full bg-transparent text-sm outline-none"
        style={{ color: "var(--sb-text)" }}
        onFocus={() => {
          setOpen(true);
          // If a value is selected, start "search mode" on focus.
          if (query.trim() === selectedLabel.trim() && selectedLabel.trim()) {
            setQuery("");
          }
        }}
        onBlur={() => {
          setOpen(false);
          if (!query.trim() && selectedLabel.trim()) setQuery(selectedLabel);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            e.preventDefault();
            commitIfExact();
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />

      {open ? (
        <div
          role="listbox"
          id={listId}
          aria-label={`${props.ariaLabel} options`}
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[340px] overflow-auto rounded-2xl border p-1 shadow-lg backdrop-blur-md"
          style={{ 
            borderColor: "var(--sb-border)",
            background: "var(--sb-card)",
          }}
        >
          {filtered.map((o) => {
            const active = o.value === props.value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                className={[
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                  active
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                ].join(" ")}
                style={!active ? { color: "var(--sb-text)" } : undefined}
                onMouseDown={(e) => {
                  // Keep the input focused so clicks reliably register
                  e.preventDefault();
                }}
                onClick={() => {
                  props.onChange(o.value);
                  setOpen(false);
                  inputRef.current?.blur();
                }}
              >
                <span className="truncate">{o.label}</span>
                {active ? (
                  <Check className="ml-3 h-4 w-4 flex-shrink-0" strokeWidth={2.5} />
                ) : null}
              </button>
            );
          })}
          {!filtered.length ? (
            <div className="px-3 py-2 text-sm" style={{ color: "var(--sb-muted)" }}>
              No matches.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

