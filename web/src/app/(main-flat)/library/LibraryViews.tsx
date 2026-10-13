"use client";

import { Bookmark, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
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
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Views">
      {LIBRARY_PRESETS.map((p) => (
        <Chip key={p.id} selected={preset === p.id} onClick={() => onApply(presetFilters(p.id, filters, today))}>
          {p.label}
        </Chip>
      ))}

      {saved.map((view) => {
        const active = savedViewMatches(view, filters);
        return (
          <span key={view.name} className="inline-flex items-center">
            <Chip selected={active} className="rounded-r-none pr-2" onClick={() => onApply(filtersForSavedView(view))}>
              <Bookmark className="h-3 w-3" aria-hidden="true" />
              {view.name}
            </Chip>
            <button
              type="button"
              aria-label={`Remove saved view ${view.name}`}
              title="Remove"
              onClick={() => persist(removeSavedView(saved, view.name))}
              className={[
                "sb-ring inline-flex h-full items-center rounded-r-full px-1.5 py-1.5 transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]",
                active
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-white/70 text-black/60 hover:bg-white dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20",
              ].join(" ")}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {naming ? (
        <form
          className="inline-flex items-center gap-1.5"
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
        <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(true)}>
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
