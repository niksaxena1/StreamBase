"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, User, Music } from "lucide-react";
import { formatInt } from "@/lib/format";
import { foldForSearch } from "@/lib/searchFold";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

export type ComboboxOption = {
  value: string;
  label: string;
  imageUrl?: string | null;
  isAllCatalog?: boolean;
  trackCount?: number | null;
};

export function Combobox(props: {
  value: string | null;
  options: ComboboxOption[];
  placeholder?: string;
  ariaLabel: string;
  onChange: (nextValue: string) => void;
  className?: string;
  imageShape?: "circle" | "square";
  showThumbnails?: boolean;
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
    const q = foldForSearch(effectiveQuery);
    if (!q) return props.options; // Show all options when no search query
    return props.options.filter((o) => foldForSearch(o.label).includes(q));
  }, [open, props.options, query, selectedLabel]);

  function commitIfExact() {
    const q = foldForSearch(query);
    if (!q) return;
    const exact = props.options.find((o) => foldForSearch(o.label) === q);
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
        className="w-full bg-transparent text-sm outline-none placeholder:text-black/40 dark:placeholder:text-white/40"
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
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[100] max-h-[340px] overflow-auto rounded-2xl border p-1 shadow-lg backdrop-blur-md bg-white/98 dark:bg-[rgba(20,20,25,0.98)]"
          style={{ 
            borderColor: "var(--sb-border)",
          }}
        >
          {filtered.map((o) => {
            const active = o.value === props.value;
            const showThumb = props.showThumbnails !== false;
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
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {showThumb ? (
                    o.isAllCatalog ? (
                      <div
                        className={`h-5 w-5 ${props.imageShape === "square" ? "rounded-lg" : "rounded-full"} bg-black/10 dark:bg-white/20 flex items-center justify-center flex-shrink-0`}
                        style={{ background: "var(--sb-accent)" }}
                      >
                        <Music className="h-3 w-3" style={{ color: "black" }} />
                      </div>
                    ) : o.imageUrl ? (
                      <PreviewableArtwork
                        src={o.imageUrl}
                        alt={o.label}
                        width={20}
                        height={20}
                        interactive="inline"
                        className={`h-5 w-5 ${props.imageShape === "square" ? "rounded-lg" : "rounded-full"} object-cover flex-shrink-0`}
                      />
                    ) : (
                      <div className={`h-5 w-5 ${props.imageShape === "square" ? "rounded-lg" : "rounded-full"} bg-white/60 dark:bg-white/10 flex items-center justify-center flex-shrink-0`}>
                        <User className="h-3 w-3 opacity-40" />
                      </div>
                    )
                  ) : null}
                  <span className="truncate">{o.label}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {o.trackCount !== null && o.trackCount !== undefined && (
                    <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                      {formatInt(o.trackCount)} tracks
                    </span>
                  )}
                  {active ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  ) : null}
                </div>
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

