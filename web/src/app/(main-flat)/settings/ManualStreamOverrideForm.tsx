"use client";

import { useMemo, useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { Alert } from "@/components/ui/Alert";

type Track = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
};

type ManualStreamOverrideFormProps = {
  addStreamOverride: (formData: FormData) => Promise<void>;
  tracks: Track[];
  defaultRunDate?: string | null;
  suggestions?: Array<{
    isrc: string;
    code: "catalog_streams_missing_prev_nonzero" | "catalog_missing_stream_snapshots";
    suggestedStreams: number | null;
    prevStreams: number | null;
  }>;
};

export function ManualStreamOverrideForm({
  addStreamOverride,
  tracks,
  defaultRunDate,
  suggestions,
}: ManualStreamOverrideFormProps) {
  const [runDate, setRunDate] = useState<string>(defaultRunDate ?? "");
  const [selectedIsrc, setSelectedIsrc] = useState<string>("");
  const [streams, setStreams] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [recompute, setRecompute] = useState<boolean>(true);
  const [suggestQ, setSuggestQ] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackOptions: ComboboxOption[] = useMemo(
    () =>
      tracks.map((t) => {
        const artists = (t.spotify_artist_names ?? []).join(", ");
        const label = t.name ? (artists ? `${t.name} • ${artists}` : t.name) : t.isrc;
        return { value: t.isrc, label, imageUrl: t.spotify_album_image_url };
      }),
    [tracks],
  );

  const trackByIsrc = useMemo(() => {
    const m = new Map<string, Track>();
    for (const t of tracks) m.set(String(t.isrc ?? "").trim().toUpperCase(), t);
    return m;
  }, [tracks]);

  const filteredSuggestions = useMemo(() => {
    const list = Array.isArray(suggestions) ? suggestions : [];
    const q = suggestQ.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) => {
      const isrc = (s.isrc ?? "").toLowerCase();
      const t = trackByIsrc.get(String(s.isrc ?? "").trim().toUpperCase());
      const name = (t?.name ?? "").toLowerCase();
      const artists = (t?.spotify_artist_names ?? []).join(", ").toLowerCase();
      return isrc.includes(q) || name.includes(q) || artists.includes(q);
    });
  }, [suggestions, suggestQ, trackByIsrc]);

  function applySuggestion(s: { isrc: string; code: string; suggestedStreams: number | null; prevStreams: number | null }) {
    const isrc = String(s.isrc ?? "").trim().toUpperCase();
    setSelectedIsrc(isrc);
    if (s.suggestedStreams != null && Number.isFinite(s.suggestedStreams)) {
      setStreams(String(Math.max(0, Math.trunc(Number(s.suggestedStreams)))));
    }
    // Prefill a note template if empty (required in UI anyway).
    setNote((prev) => {
      const p = String(prev ?? "").trim();
      if (p) return p;
      return `Manual override from Settings: ${s.code} (run_date=${runDate || (defaultRunDate ?? "")}, isrc=${isrc}).`;
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const isrc = String(selectedIsrc ?? "").trim().toUpperCase().replace(/\s+/g, "");
    const d = String(runDate ?? "").trim();
    const s = String(streams ?? "").trim();
    const n = String(note ?? "").trim();

    if (!d) return setError("Please choose a run date.");
    if (!isrc) return setError("Please select a track.");
    if (!/^[A-Z0-9]{12}$/.test(isrc)) return setError("Invalid ISRC. Expected 12 characters (A-Z/0-9).");
    if (!/^\d+$/.test(s)) return setError("Streams must be a whole number (digits only).");
    if (!n) return setError("Please add a note (required for auditability).");

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("date", d);
      formData.set("isrc", isrc);
      formData.set("streams_cumulative_override", s);
      formData.set("note", n);
      formData.set("recompute", recompute ? "true" : "false");

      await addStreamOverride(formData);

      // Reset input fields (keep runDate for convenience).
      setSelectedIsrc("");
      setStreams("");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="sb-ring rounded-2xl bg-white/70 p-3 dark:bg-white/5">
      {Array.isArray(suggestions) && suggestions.length > 0 ? (
        <div className="mb-3 rounded-xl border bg-white/60 p-3 dark:bg-white/[0.03]" style={{ borderColor: "var(--sb-border)" }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Suggested missing snapshots</div>
              <div className="mt-1 text-xs opacity-70">
                From Health warnings on the latest run date. Click a track to prefill the override form.
              </div>
            </div>
            <input
              value={suggestQ}
              onChange={(e) => setSuggestQ(e.target.value)}
              placeholder="Filter by ISRC, name, artist…"
              className="sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40 sm:w-80"
            />
          </div>

          <div className="mt-3 grid gap-2">
            {filteredSuggestions.slice(0, 50).map((s) => {
              const isrc = String(s.isrc ?? "").trim().toUpperCase();
              const t = trackByIsrc.get(isrc);
              const name = t?.name ?? isrc;
              const artists = (t?.spotify_artist_names ?? []).join(", ");
              const imageUrl = t?.spotify_album_image_url ?? null;
              const code = s.code;
              const hint =
                code === "catalog_streams_missing_prev_nonzero"
                  ? s.prevStreams != null
                    ? `yesterday=${Intl.NumberFormat().format(s.prevStreams)}`
                    : "yesterday=unknown"
                  : "missing snapshot";
              return (
                <button
                  key={`${code}-${isrc}`}
                  type="button"
                  onClick={() => applySuggestion(s)}
                  className="sb-ring flex items-center gap-3 rounded-xl bg-white/70 px-3 py-2 text-left text-sm transition hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
                >
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={name}
                      className="h-10 w-10 rounded-lg object-cover sb-ring flex-shrink-0"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{name}</div>
                      <span className="font-mono text-[10px] opacity-60">{isrc}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] opacity-70 truncate">
                      {artists ? `${artists} • ` : ""}
                      <span className="font-mono">{code}</span> • {hint}
                    </div>
                  </div>
                  <div className="text-[11px] font-medium opacity-70">Use</div>
                </button>
              );
            })}
            {filteredSuggestions.length === 0 ? (
              <div className="text-xs opacity-60">No suggestions match your filter.</div>
            ) : null}
            {filteredSuggestions.length > 50 ? (
              <div className="text-[11px] opacity-60">
                Showing first 50 of {filteredSuggestions.length}.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="grid gap-2 sm:grid-cols-12">
        <div className="sm:col-span-3">
          <label className="block text-[11px] font-medium opacity-70">Run date (UTC)</label>
          <input
            type="date"
            value={runDate}
            onChange={(e) => setRunDate(e.target.value)}
            className="mt-1 sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none dark:bg-white/5"
          />
          <div className="mt-1 text-[11px] opacity-60">
            This is the ingestion snapshot date (not “data date”).
          </div>
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[11px] font-medium opacity-70">Track</label>
          <div className="mt-1 sb-ring w-full rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
            <Combobox
              value={selectedIsrc}
              options={trackOptions}
              placeholder="Search by name, artist or ISRC…"
              ariaLabel="Select track to override"
              onChange={setSelectedIsrc}
              imageShape="square"
            />
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium opacity-70">Cumulative streams</label>
          <input
            value={streams}
            onChange={(e) => setStreams(e.target.value)}
            inputMode="numeric"
            placeholder="e.g. 123456"
            className="mt-1 sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40"
          />
          <div className="mt-1 text-[11px] opacity-60">Whole number.</div>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium opacity-70">After save</label>
          <label className="mt-1 flex items-center gap-2 sb-ring rounded-xl bg-white/70 px-3 py-2 text-xs dark:bg-white/5">
            <input
              type="checkbox"
              checked={recompute}
              onChange={(e) => setRecompute(e.target.checked)}
            />
            Recompute playlist totals for this date
          </label>
          <div className="mt-1 text-[11px] opacity-60">
            Updates <span className="font-mono">playlist_daily_stats</span>.
          </div>
        </div>

        <div className="sm:col-span-12">
          <label className="block text-[11px] font-medium opacity-70">Note (required)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this being overridden? (source issue, manual verification, etc.)"
            className="mt-1 sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40"
          />
        </div>

        <div className="sm:col-span-12 flex items-end justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="sb-ring rounded-xl bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSubmitting ? "Saving…" : "Save override"}
          </button>
        </div>
      </form>

      {error && (
        <Alert variant="error" title="Could not save override" className="mt-3">
          {error}
        </Alert>
      )}
    </div>
  );
}

