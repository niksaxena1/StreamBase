"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { showToast } from "@/lib/toast";
import {
  COLLECTION_COLOR_PRESETS,
  COLLECTION_NAME_MAX,
  sortCollections,
  type PlaylistWatchCollection,
} from "./collectionsModel";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function callApi(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  if (!res.ok || !json?.success) throw new Error(json?.error ?? "Request failed");
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ColorDot({ color, className = "h-2.5 w-2.5" }: { color: string | null; className?: string }) {
  if (!color) return null;
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}

function Swatches({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Collection color">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        title="No color"
        className="sb-ring grid h-5 w-5 place-items-center rounded-full text-[10px] disabled:opacity-40"
        style={{ outline: value === null ? "2px solid var(--sb-accent)" : undefined, color: "var(--sb-muted)" }}
      >
        -
      </button>
      {COLLECTION_COLOR_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          disabled={disabled}
          onClick={() => onChange(color)}
          aria-pressed={value === color}
          aria-label={`Color ${color}`}
          title={color}
          className="h-5 w-5 rounded-full disabled:opacity-40"
          style={{ background: color, outline: value === color ? "2px solid var(--sb-accent)" : undefined, outlineOffset: 1 }}
        />
      ))}
    </div>
  );
}

function ManagerRow({
  collection,
  index,
  total,
  busy,
  onRename,
  onRecolor,
  onMove,
  onDelete,
}: {
  collection: PlaylistWatchCollection;
  index: number;
  total: number;
  busy: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: string | null) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(collection.name);
  const [confirming, setConfirming] = useState(false);

  function commit() {
    const next = draft.trim();
    if (!next) {
      setDraft(collection.name);
      return;
    }
    if (next !== collection.name) onRename(next);
  }

  return (
    <li className="rounded-lg border p-2.5" style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          maxLength={COLLECTION_NAME_MAX}
          disabled={busy}
          aria-label={`Rename ${collection.name}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(collection.name);
          }}
          className="sb-ring h-8 min-w-0 flex-1 rounded-lg bg-white/60 px-2.5 text-sm outline-none dark:bg-white/10"
          style={{ color: "var(--sb-text)" }}
        />
        <button
          type="button"
          title="Move up"
          aria-label={`Move ${collection.name} up`}
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
          className="sb-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Move down"
          aria-label={`Move ${collection.name} down`}
          disabled={busy || index === total - 1}
          onClick={() => onMove(1)}
          className="sb-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Swatches value={collection.color} onChange={onRecolor} disabled={busy} />
        {confirming ? (
          <div className="flex items-center gap-1.5 text-xs">
            <span style={{ color: "var(--sb-muted)" }}>Delete? Playlists stay watched.</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
              className="sb-ring rounded-lg px-2 py-1 font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-40"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="sb-ring rounded-lg px-2 py-1 font-medium hover:bg-black/5 dark:hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            title="Delete collection"
            aria-label={`Delete ${collection.name}`}
            className="sb-ring grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-500/10 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </li>
  );
}

export function CollectionsManagerModal({
  open,
  onClose,
  collections,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  collections: PlaylistWatchCollection[];
  /** Called after any successful change so the page can refresh its data. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const ordered = sortCollections(collections);

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (success) showToast(success, "success");
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(async () => {
      await callApi("/api/playlist-watch/collections", "POST", { name, color: newColor });
      setNewName("");
      setNewColor(null);
    }, "Collection created");
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void run(async () => {
      // Normalise to 0..n-1 so ties from older data cannot make a move a no-op.
      for (let i = 0; i < next.length; i++) {
        if (next[i]!.sortOrder !== i) {
          await callApi(`/api/playlist-watch/collections/${next[i]!.id}`, "PATCH", { sort_order: i });
        }
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Collections"
      subtitle="Named groups of playlists, shared with everyone who uses Playlist Watch."
      maxWidthClassName="max-w-xl"
    >
      <div className="space-y-4">
        {error ? (
          <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <form onSubmit={create} className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: "var(--sb-border)" }}>
          <div className="flex items-center gap-2">
            <input
              value={newName}
              maxLength={COLLECTION_NAME_MAX}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New collection, e.g. Ads · Account A"
              aria-label="New collection name"
              className="sb-ring h-8 min-w-0 flex-1 rounded-lg bg-white/60 px-2.5 text-sm outline-none dark:bg-white/10"
              style={{ color: "var(--sb-text)" }}
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="sb-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-black px-3 text-xs font-semibold text-white hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/85"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Create
            </button>
          </div>
          <Swatches value={newColor} onChange={setNewColor} disabled={busy} />
        </form>

        {ordered.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
            No collections yet. Create one above, then add playlists from the list.
          </p>
        ) : (
          <ul className="space-y-2">
            {ordered.map((collection, index) => (
              <ManagerRow
                key={`${collection.id}:${collection.name}`}
                collection={collection}
                index={index}
                total={ordered.length}
                busy={busy}
                onRename={(name) =>
                  void run(() => callApi(`/api/playlist-watch/collections/${collection.id}`, "PATCH", { name }), "Collection renamed")
                }
                onRecolor={(color) =>
                  void run(() => callApi(`/api/playlist-watch/collections/${collection.id}`, "PATCH", { color }))
                }
                onMove={(direction) => move(index, direction)}
                onDelete={() =>
                  void run(() => callApi(`/api/playlist-watch/collections/${collection.id}`, "DELETE"), "Collection deleted")
                }
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function CheckRow({
  label,
  color,
  state,
  disabled,
  onToggle,
}: {
  label: string;
  color: string | null;
  state: "all" | "some" | "none";
  disabled: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
      <input
        ref={ref}
        type="checkbox"
        checked={state === "all"}
        disabled={disabled}
        onChange={onToggle}
        className="h-4 w-4 accent-[var(--sb-accent)]"
      />
      <ColorDot color={color} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {state === "some" ? (
        <span className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
          some
        </span>
      ) : null}
    </label>
  );
}

/**
 * Add/remove one playlist (or a bulk selection) to collections. Mount it only while open so the
 * local membership copy starts from fresh props; changes apply immediately.
 */
export function CollectionMembershipModal({
  playlistIds,
  title,
  collections,
  onClose,
  onChanged,
  onManage,
}: {
  playlistIds: string[];
  title: string;
  collections: PlaylistWatchCollection[];
  onClose: () => void;
  onChanged: () => void;
  onManage: () => void;
}) {
  const [membership, setMembership] = useState(
    () => new Map(collections.map((c) => [c.id, new Set(c.playlistIds)])),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function stateFor(collectionId: string): "all" | "some" | "none" {
    const members = membership.get(collectionId);
    const hits = playlistIds.filter((id) => members?.has(id)).length;
    if (hits === 0) return "none";
    return hits === playlistIds.length ? "all" : "some";
  }

  async function toggle(collectionId: string) {
    const members = new Set(membership.get(collectionId) ?? []);
    const removing = stateFor(collectionId) === "all";
    const ids = removing ? playlistIds : playlistIds.filter((id) => !members.has(id));
    if (ids.length === 0) return;
    setBusyId(collectionId);
    setError(null);
    try {
      await callApi(`/api/playlist-watch/collections/${collectionId}`, "PUT", removing ? { remove: ids } : { add: ids });
      for (const id of ids) {
        if (removing) members.delete(id);
        else members.add(id);
      }
      setMembership((prev) => new Map(prev).set(collectionId, members));
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyId(null);
    }
  }

  const ordered = sortCollections(collections);
  return (
    <Modal
      open
      onClose={onClose}
      title="Add to collections"
      subtitle={title}
      maxWidthClassName="max-w-sm"
    >
      <div className="space-y-2">
        {error ? (
          <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}
        {ordered.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
            No collections yet.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            {ordered.map((collection) => (
              <CheckRow
                key={collection.id}
                label={collection.name}
                color={collection.color}
                state={stateFor(collection.id)}
                disabled={busyId !== null}
                onToggle={() => void toggle(collection.id)}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={onManage}
          className="text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--sb-muted)" }}
        >
          Manage collections
        </button>
      </div>
    </Modal>
  );
}
