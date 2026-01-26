"use client";

import { useState, useTransition } from "react";
import { GripVertical, Music } from "lucide-react";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";

type Playlist = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  display_order: number | null;
};

type PlaylistSettingsTableProps = {
  playlists: Playlist[];
  updatePlaylist: (formData: FormData) => Promise<void>;
  reorderPlaylists: (updates: { playlist_key: string; display_order: number }[]) => Promise<void>;
};

export function PlaylistSettingsTable({
  playlists: initialPlaylists,
  updatePlaylist,
  reorderPlaylists,
}: PlaylistSettingsTableProps) {
  const [playlists, setPlaylists] = useState(initialPlaylists);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <GlassTable headers={["", "", "Playlist", "Spotify playlist (URL/URI/ID)"]}>
      {playlists.map((p, index) => {
        const isAllCatalog = p.playlist_key === "all_catalog";
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
                  Not a Spotify playlist
                </span>
              ) : (
                <form action={updatePlaylist} className="flex items-center gap-2">
                  <input type="hidden" name="playlist_key" value={p.playlist_key} />
                  <input
                    name="spotify_playlist_id"
                    defaultValue={p.spotify_playlist_id ?? ""}
                    placeholder="https://open.spotify.com/playlist/…"
                    className="sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40"
                  />
                  <button
                    type="submit"
                    className="sb-ring rounded-xl bg-black px-3 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                  >
                    Save
                  </button>
                </form>
              )}
            </TableCell>
          </TableRow>
        );
      })}
      {!playlists.length && (
        <TableRow>
          <TableCell className="text-center opacity-50 py-8" colSpan={4}>
            No playlists found.
          </TableCell>
        </TableRow>
      )}
    </GlassTable>
  );
}
