"use client";

import { useState, useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";

type Track = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
};

type Playlist = {
  playlist_key: string;
  display_name: string;
};

type TrackExclusionFormProps = {
  addHealthExclusion: (formData: FormData) => Promise<void>;
  tracks: Track[];
  playlists: Playlist[];
};

export function TrackExclusionForm({ addHealthExclusion, tracks, playlists }: TrackExclusionFormProps) {
  const [selectedPlaylistKey, setSelectedPlaylistKey] = useState<string>("");
  const [selectedTrackIsrc, setSelectedTrackIsrc] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackOptions: ComboboxOption[] = useMemo(
    () =>
      tracks.map((t) => {
        const artists = (t.spotify_artist_names ?? []).join(", ");
        const label = t.name ? (artists ? `${t.name} • ${artists}` : t.name) : t.isrc;
        return {
          value: t.isrc,
          label,
          imageUrl: t.spotify_album_image_url,
        };
      }),
    [tracks],
  );

  const playlistOptions: ComboboxOption[] = useMemo(
    () =>
      playlists.map((p) => ({
        value: p.playlist_key,
        label: p.display_name,
      })),
    [playlists],
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!selectedTrackIsrc.trim()) {
      setError("Please select a track");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      if (selectedPlaylistKey) formData.set("playlist_key", selectedPlaylistKey);
      formData.set("isrc", selectedTrackIsrc);
      if (note) formData.set("note", note);

      await addHealthExclusion(formData);

      // Reset form
      setSelectedPlaylistKey("");
      setSelectedTrackIsrc("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add exclusion");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      <form onSubmit={handleSubmit} className="grid gap-2 sm:grid-cols-12">
        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium opacity-70">Playlist scope</label>
          <div className="mt-1 flex items-center gap-2">
            <div className="sb-ring flex-1 rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
              <Combobox
                value={selectedPlaylistKey}
                options={playlistOptions}
                placeholder="All playlists (optional)"
                ariaLabel="Select playlist scope"
                onChange={setSelectedPlaylistKey}
              />
            </div>
            {selectedPlaylistKey && (
              <button
                type="button"
                onClick={() => setSelectedPlaylistKey("")}
                className="sb-ring rounded-xl bg-white/70 px-2 py-2 text-xs font-medium text-black/60 transition hover:bg-white dark:bg-white/5 dark:text-white/60 dark:hover:bg-white/10"
                title="Clear playlist selection"
              >
                ✕
              </button>
            )}
          </div>
          <div className="mt-1 text-[11px] opacity-60">
            Leave blank to apply to all playlists.
          </div>
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[11px] font-medium opacity-70">Track</label>
          <div className="mt-1 sb-ring w-full rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
            <Combobox
              value={selectedTrackIsrc}
              options={trackOptions}
              placeholder="Search by name, artist or ISRC…"
              ariaLabel="Select track to exclude"
              onChange={setSelectedTrackIsrc}
              imageShape="square"
            />
          </div>
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[11px] font-medium opacity-70">Note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Intentional non-catalog track"
            className="mt-1 sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40"
          />
        </div>

        <div className="sm:col-span-1 flex items-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="sb-ring w-full rounded-xl bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSubmitting ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-3 rounded-xl bg-red-50 p-2 text-xs text-red-900 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
