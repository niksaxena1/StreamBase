"use client";

import { Bookmark, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { LibraryFilters } from "@/lib/library/filters";
import {
  LIBRARY_PRESETS,
  SAVED_VIEWS_KEY,
  activePreset,
  addSavedView,
  filtersForSavedView,
  parseSavedViews,
  presetFilters,
  readSavedViewsRaw,
  removeSavedView,
  savedViewMatches,
  savedViewQuery,
  writeSavedViews,
  type SavedView,
} from "@/lib/library/views";

const tabClass = (active: boolean) => [
  "inline-flex h-6 shrink-0 items-center gap-1 border-b-2 px-2 text-[11px] whitespace-nowrap transition",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sb-accent)]",
  active ? "border-[var(--sb-accent)] text-[var(--sb-text)] font-semibold" : "border-transparent text-[var(--sb-muted)] hover:bg-[var(--sb-row-hover)]",
].join(" ");

const CHANGED_EVENT = "sb:library:saved-views-changed";

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SAVED_VIEWS_KEY || event.key === null) notify();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED_EVENT, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED_EVENT, notify);
  };
}

/** Preset views and the viewer's own saved views (kept in this browser's localStorage). */
export function LibraryViews({
  filters,
  today,
  onApply,
}: {
  filters: LibraryFilters;
  today: string;
  onApply: (filters: LibraryFilters) => void;
}) {
  const raw = useSyncExternalStore(subscribe, () => readSavedViewsRaw(), () => null);
  const saved = useMemo(() => parseSavedViews(raw), [raw]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);

  const preset = activePreset(filters, today);

  function persist(next: SavedView[]) {
    if (writeSavedViews(next)) {
      setStorageFailed(false);
      window.dispatchEvent(new Event(CHANGED_EVENT));
    } else {
      setStorageFailed(true);
    }
  }

  function submit() {
    if (!name.trim()) return;
    persist(addSavedView(saved, name, savedViewQuery(filters)));
    setName("");
    setNaming(false);
  }

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap" role="group" aria-label="Views">
      {LIBRARY_PRESETS.map((p) => (
        <button type="button" key={p.id} className={tabClass(preset === p.id)} aria-pressed={preset === p.id} onClick={() => onApply(presetFilters(p.id, filters, today))}>
          {p.label}
        </button>
      ))}

      {saved.map((view) => {
        const active = savedViewMatches(view, filters);
        return (
          <span key={view.name} className="inline-flex shrink-0 items-center">
            <button type="button" aria-pressed={active} className={tabClass(active)} onClick={() => onApply(filtersForSavedView(view))}>
              <Bookmark className="h-3 w-3" aria-hidden="true" />
              {view.name}
            </button>
            <button
              type="button"
              aria-label={`Remove saved view ${view.name}`}
              title="Remove"
              onClick={() => persist(removeSavedView(saved, view.name))}
              className={`${tabClass(active)} px-1`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {naming ? (
        <form
          className="inline-flex shrink-0 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            aria-label="Name for this view"
            placeholder="View name"
            maxLength={40}
            className="w-40 py-1 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setNaming(false);
                setName("");
              }
            }}
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim()}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setNaming(false);
              setName("");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <Button type="button" size="xs" className="shrink-0 whitespace-nowrap" variant="ghost" onClick={() => setNaming(true)}>
          Save view…
        </Button>
      )}

      {storageFailed ? (
        <span className="text-[11px]" style={{ color: "var(--sb-error)" }} role="status">
          Couldn&apos;t save. This browser is blocking local storage.
        </span>
      ) : null}
    </div>
  );
}
