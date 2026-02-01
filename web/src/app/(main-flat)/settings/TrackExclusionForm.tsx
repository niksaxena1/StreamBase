"use client";

import { useState, useMemo } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";

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
  notePlaceholder?: string;
  allowMulti?: boolean;
  submitLabel?: string;
};

export function TrackExclusionForm({
  addHealthExclusion,
  tracks,
  playlists,
  notePlaceholder,
  allowMulti,
  submitLabel,
}: TrackExclusionFormProps) {
  const [selectedPlaylistKey, setSelectedPlaylistKey] = useState<string>("");
  const [selectedTrackIsrc, setSelectedTrackIsrc] = useState<string>("");
  const [selectedTrackIsrcs, setSelectedTrackIsrcs] = useState<string[]>([]);
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

  const trackLabelByIsrc = useMemo(() => {
    const m = new Map<string, { label: string; imageUrl?: string | null }>();
    for (const o of trackOptions) m.set(o.value, { label: o.label, imageUrl: o.imageUrl });
    return m;
  }, [trackOptions]);

  const playlistOptions: ComboboxOption[] = useMemo(
    () =>
      playlists.map((p) => ({
        value: p.playlist_key,
        label: p.display_name,
      })),
    [playlists],
  );

  function addSelectedIsrc(isrcRaw: string) {
    const isrc = String(isrcRaw ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!isrc) return;
    setSelectedTrackIsrcs((prev) => (prev.includes(isrc) ? prev : [...prev, isrc]));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const isrcs = allowMulti
      ? selectedTrackIsrcs
      : [String(selectedTrackIsrc ?? "").trim().toUpperCase().replace(/\s+/g, "")].filter(Boolean);

    if (isrcs.length === 0) {
      setError("Please select at least one track");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      if (selectedPlaylistKey) formData.set("playlist_key", selectedPlaylistKey);
      if (allowMulti) {
        formData.set("isrcs", JSON.stringify(isrcs));
      } else {
        formData.set("isrc", isrcs[0]);
      }
      if (note) formData.set("note", note);

      await addHealthExclusion(formData);

      // Reset form
      setSelectedPlaylistKey("");
      setSelectedTrackIsrc("");
      setSelectedTrackIsrcs([]);
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
              <IconButton
                type="button"
                onClick={() => setSelectedPlaylistKey("")}
                title="Clear playlist selection"
                aria-label="Clear playlist selection"
                variant="secondary"
                className="rounded-xl"
              >
                <span className="text-xs leading-none">✕</span>
              </IconButton>
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
              onChange={(next) => {
                if (allowMulti) {
                  addSelectedIsrc(next);
                  // Keep it fast to add many: clear the combobox for the next search.
                  setSelectedTrackIsrc("");
                  return;
                }
                setSelectedTrackIsrc(next);
              }}
              imageShape="square"
            />
          </div>
          {allowMulti && selectedTrackIsrcs.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedTrackIsrcs.map((isrc) => {
                const meta = trackLabelByIsrc.get(isrc);
                return (
                  <Chip
                    key={isrc}
                    onClick={() => setSelectedTrackIsrcs((prev) => prev.filter((x) => x !== isrc))}
                    title="Remove"
                  >
                    <span className="font-mono opacity-70">{isrc}</span>
                    <span className="max-w-[260px] truncate opacity-80">{meta?.label ?? "selected"}</span>
                    <span className="opacity-50">✕</span>
                  </Chip>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedTrackIsrcs([])}
                className="text-[11px] underline opacity-60 hover:opacity-100"
                title="Clear selected tracks"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[11px] font-medium opacity-70">Note (optional)</label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={notePlaceholder ?? "Optional note"}
            className="mt-1"
          />
        </div>

        <div className="sm:col-span-1 flex items-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            variant="primary"
            size="md"
            className="w-full rounded-xl"
          >
            {isSubmitting ? "Adding…" : (submitLabel ?? (allowMulti ? "Add all" : "Add"))}
          </Button>
        </div>
      </form>

      {error && (
        <Alert variant="error" title="Could not save exclusion" className="mt-3">
          {error}
        </Alert>
      )}
    </div>
  );
}
