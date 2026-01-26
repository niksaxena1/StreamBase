"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { GripVertical, Music } from "lucide-react";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";

type Playlist = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  display_order: number | null;
  collector?: string | null;
};

type PlaylistSettingsTableProps = {
  playlists: Playlist[];
  updatePlaylist: (formData: FormData) => Promise<void>;
  updateCollector: (formData: FormData) => Promise<void>;
  reorderPlaylists: (updates: { playlist_key: string; display_order: number }[]) => Promise<void>;
};

export function PlaylistSettingsTable({
  playlists: initialPlaylists,
  updatePlaylist,
  updateCollector,
  reorderPlaylists,
}: PlaylistSettingsTableProps) {
  const [playlists, setPlaylists] = useState(initialPlaylists);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const [collectorDraft, setCollectorDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialPlaylists.map((p) => [p.playlist_key, String(p.collector ?? "")])),
  );
  const [spotifyDraft, setSpotifyDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialPlaylists.map((p) => [p.playlist_key, String(p.spotify_playlist_id ?? "")])),
  );

  type FieldStatus = "idle" | "saving" | "saved" | "error";
  const [status, setStatus] = useState<Record<string, FieldStatus>>({});
  const clearTimersRef = useRef<Record<string, number>>({});
  const debounceTimersRef = useRef<Record<string, number>>({});

  const playlistByKey = useMemo(
    () => new Map(playlists.map((p) => [p.playlist_key, p])),
    [playlists],
  );

  useEffect(() => {
    return () => {
      // Clear pending timers on unmount
      for (const t of Object.values(clearTimersRef.current)) window.clearTimeout(t);
      for (const t of Object.values(debounceTimersRef.current)) window.clearTimeout(t);
    };
  }, []);

  function setFieldStatus(fieldKey: string, next: FieldStatus) {
    setStatus((s) => ({ ...s, [fieldKey]: next }));

    const existing = clearTimersRef.current[fieldKey];
    if (existing) window.clearTimeout(existing);

    if (next === "saved") {
      clearTimersRef.current[fieldKey] = window.setTimeout(() => {
        setStatus((s) => ({ ...s, [fieldKey]: "idle" }));
      }, 1200);
    }
  }

  function renderStatus(fieldKey: string) {
    const s = status[fieldKey] ?? "idle";
    if (s === "idle") return null;
    if (s === "saving") return <span className="text-[11px] opacity-60">Saving…</span>;
    if (s === "saved") return <span className="text-[11px] text-lime-700 dark:text-lime-400">Saved</span>;
    return <span className="text-[11px] text-red-600 dark:text-red-400">Error</span>;
  }

  function saveCollector(playlist_key: string, collector: string) {
    const fieldKey = `${playlist_key}:collector`;
    setFieldStatus(fieldKey, "saving");

    startTransition(() => {
      void (async () => {
        try {
          const fd = new FormData();
          fd.set("playlist_key", playlist_key);
          fd.set("collector", collector);
          await updateCollector(fd);

          setPlaylists((prev) =>
            prev.map((p) =>
              p.playlist_key === playlist_key ? { ...p, collector: collector || null } : p,
            ),
          );

          setFieldStatus(fieldKey, "saved");
        } catch (e) {
          console.error("Failed to update collector:", e);
          setFieldStatus(fieldKey, "error");
        }
      })();
    });
  }

  function saveSpotifyId(playlist_key: string, raw: string) {
    const fieldKey = `${playlist_key}:spotify`;
    setFieldStatus(fieldKey, "saving");

    startTransition(() => {
      void (async () => {
        try {
          const fd = new FormData();
          fd.set("playlist_key", playlist_key);
          fd.set("spotify_playlist_id", raw);
          await updatePlaylist(fd);

          // Optimistically keep the user's raw value; server will normalize on next load.
          setPlaylists((prev) =>
            prev.map((p) =>
              p.playlist_key === playlist_key ? { ...p, spotify_playlist_id: raw || null } : p,
            ),
          );

          setFieldStatus(fieldKey, "saved");
        } catch (e) {
          console.error("Failed to update Spotify playlist ID:", e);
          setFieldStatus(fieldKey, "error");
        }
      })();
    });
  }

  async function handleDragEnd() {
    if (draggedIndex === null || dragOverIndex === null || draggedIndex === dragOverIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newPlaylists = [...playlists];
    const [draggedItem] = newPlaylists.splice(draggedIndex, 1);
    newPlaylists.splice(dragOverIndex, 0, draggedItem);

    // Update display_order values
    const updates = newPlaylists.map((p, index) => ({
      playlist_key: p.playlist_key,
      display_order: index * 10, // Use increments of 10 for easier reordering
    }));

    startTransition(async () => {
      try {
        await reorderPlaylists(updates);
        setPlaylists(newPlaylists);
      } catch (error) {
        console.error("Failed to update playlist order:", error);
      }
    });

    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  return (
    <GlassTable headers={["", "", "Playlist", "Collector", "Spotify playlist (URL/URI/ID)"]}>
      {playlists.map((p, index) => {
        const isAllCatalog = p.playlist_key === "all_catalog";
        const draftCollector = collectorDraft[p.playlist_key] ?? String(p.collector ?? "");
        const draftSpotify = spotifyDraft[p.playlist_key] ?? String(p.spotify_playlist_id ?? "");
        return (
          <TableRow
            key={p.playlist_key}
            draggable
            onDragStart={() => setDraggedIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(index);
            }}
            onDragLeave={() => {
              if (dragOverIndex === index) {
                setDragOverIndex(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDragEnd();
            }}
            onDragEnd={handleDragEnd}
            className={`${
              draggedIndex === index ? "opacity-50" : ""
            } ${
              dragOverIndex === index && draggedIndex !== index
                ? "border-t-2 border-lime-500"
                : ""
            }`}
          >
            <TableCell>
              <div
                className="flex h-8 w-8 cursor-grab items-center justify-center active:cursor-grabbing"
                style={{ color: "var(--sb-muted)" }}
              >
                <GripVertical className="h-4 w-4" />
              </div>
            </TableCell>
            <TableCell>
              {isAllCatalog ? (
                <div
                  className="sb-ring flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: "var(--sb-accent)" }}
                >
                  <Music className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
                </div>
              ) : p.spotify_playlist_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.spotify_playlist_image_url}
                  alt="Playlist cover"
                  className="h-8 w-8 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
              )}
            </TableCell>
            <TableCell>
              <div className="font-medium">{p.display_name}</div>
              <div className="font-mono text-xs opacity-60">{p.playlist_key}</div>
            </TableCell>
            <TableCell>
              {isAllCatalog ? (
                <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  —
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={draftCollector}
                    onChange={(e) => {
                      const next = e.target.value;
                      setCollectorDraft((s) => ({ ...s, [p.playlist_key]: next }));
                      saveCollector(p.playlist_key, next);
                    }}
                    className="sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none dark:bg-white/5"
                  >
                    <option value="">—</option>
                    <option value="A">A</option>
                    <option value="K">K</option>
                    <option value="N">N</option>
                    <option value="PL">PL</option>
                    <option value="TG">TG</option>
                    <option value="NL">NL</option>
                  </select>
                  {renderStatus(`${p.playlist_key}:collector`)}
                </div>
              )}
            </TableCell>
            <TableCell>
              {isAllCatalog ? (
                <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  Not a Spotify playlist
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={draftSpotify}
                    onChange={(e) => {
                      const next = e.target.value;
                      setSpotifyDraft((s) => ({ ...s, [p.playlist_key]: next }));

                      const t = debounceTimersRef.current[p.playlist_key];
                      if (t) window.clearTimeout(t);
                      debounceTimersRef.current[p.playlist_key] = window.setTimeout(() => {
                        saveSpotifyId(p.playlist_key, next);
                      }, 650);
                    }}
                    onBlur={() => {
                      const currentDraft = spotifyDraft[p.playlist_key] ?? "";
                      const currentRow = playlistByKey.get(p.playlist_key);
                      const prevSaved = String(currentRow?.spotify_playlist_id ?? "");
                      if (currentDraft !== prevSaved) saveSpotifyId(p.playlist_key, currentDraft);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="https://open.spotify.com/playlist/…"
                    className="sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40"
                  />
                  {renderStatus(`${p.playlist_key}:spotify`)}
                </div>
              )}
            </TableCell>
          </TableRow>
        );
      })}
      {!playlists.length && (
        <TableRow>
          <TableCell className="text-center opacity-50 py-8" colSpan={5}>
            No playlists found.
          </TableCell>
        </TableRow>
      )}
    </GlassTable>
  );
}
