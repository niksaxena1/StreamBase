"use client";

import { useCallback, useEffect, useState } from "react";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { NetworkCustomPlaylistMode } from "./networkScope";
import type { NetworkPlaylistOption } from "./page";

type Props = {
  open: boolean;
  onClose: () => void;
  playlists: NetworkPlaylistOption[];
  initialKeys: string[];
  initialMode: NetworkCustomPlaylistMode;
  onApply: (keys: string[], mode: NetworkCustomPlaylistMode) => void;
};

export function NetworkCustomScopeModal({
  open,
  onClose,
  playlists,
  initialKeys,
  initialMode,
  onApply,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialKeys));
  const [mode, setMode] = useState<NetworkCustomPlaylistMode>(initialMode);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialKeys));
    setMode(initialMode);
  }, [open, initialKeys, initialMode]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    const keys = [...selected].sort();
    if (keys.length === 0) return;
    onApply(keys, mode);
    onClose();
  }, [selected, mode, onApply, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom playlist scope"
      subtitle="Build the graph from tracks that match these playlist rules (current memberships). Any = track on at least one; All = on every selected playlist; Not in = catalog tracks absent from all selected playlists."
      maxWidthClassName="max-w-lg"
    >
      <div className="space-y-4 text-sm" style={{ color: "var(--sb-text)" }}>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--sb-muted)" }}>
            Rule
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["any", "Any of"],
                ["all", "All of"],
                ["none", "Not in"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: "var(--sb-border)",
                  backgroundColor: mode === k ? "var(--sb-accent)" : "var(--sb-card)",
                  color: mode === k ? "black" : "var(--sb-muted)",
                }}
                onClick={() => setMode(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--sb-muted)" }}>
            Playlists ({selected.size} selected)
          </div>
          <div
            className="max-h-[min(50vh,320px)] overflow-y-auto rounded-xl border p-2 space-y-1"
            style={{ borderColor: "var(--sb-border)" }}
          >
            {playlists.map((p) => (
              <label
                key={p.playlist_key}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer hover:opacity-90"
                style={{ backgroundColor: "var(--sb-surface)" }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.playlist_key)}
                  onChange={() => toggle(p.playlist_key)}
                  className="rounded border shrink-0"
                  style={{ borderColor: "var(--sb-border)" }}
                />
                {p.spotify_playlist_image_url ? (
                  <PreviewableArtwork
                    src={p.spotify_playlist_image_url}
                    alt={p.display_name}
                    width={24}
                    height={24}
                    interactive="inline"
                    className="h-6 w-6 shrink-0 rounded-sm object-cover"
                  />
                ) : (
                  <div
                    className="h-6 w-6 shrink-0 rounded-sm"
                    style={{ backgroundColor: "var(--sb-surface)" }}
                    aria-hidden
                  />
                )}
                <span className="truncate flex-1 min-w-0">{p.display_name}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--sb-border)" }}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleApply} disabled={selected.size === 0}>
            Apply scope
          </Button>
        </div>
      </div>
    </Modal>
  );
}
