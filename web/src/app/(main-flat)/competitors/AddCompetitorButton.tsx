"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Alert } from "@/components/ui/Alert";
import { normalizeAccentHex, slugifyKey } from "@/lib/competitors/onboardingParsers";

type LabelOption = { value: string; label: string };
type FieldErrors = Record<string, string>;
type Created = { label_key: string; playlist_key: string; created_label: boolean };

const EMPTY_FORM = {
  labelMode: "new" as "new" | "existing",
  existingLabel: "",
  labelName: "",
  labelKey: "",
  accent: "",
  playlistName: "",
  playlistKey: "",
  spotifyPlaylist: "",
  sotPlaylist: "",
  sotDashboardUrl: "",
  sotDashboardName: "",
  minRows: "1",
};

function Field(props: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
        {props.label}
      </span>
      {props.children}
      {props.error ? (
        <span className="block text-xs text-red-600 dark:text-red-400">{props.error}</span>
      ) : props.hint ? (
        <span className="block text-[11px]" style={{ color: "var(--sb-muted)" }}>
          {props.hint}
        </span>
      ) : null}
    </label>
  );
}

/**
 * "Add competitor" on /competitors: writes competitor.labels/playlists via
 * /api/competitors/onboard. The competitor workflows read those tables, so
 * the playlist is tracked from the next scheduled pipeline run.
 */
export function AddCompetitorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [labels, setLabels] = useState<LabelOption[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/competitors/labels/options")
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled && body?.success) setLabels(body.data.labels as LabelOption[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const set = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const derivedLabelKey = form.labelKey.trim() || slugifyKey(form.labelName);
  const derivedPlaylistKey = form.playlistKey.trim() || slugifyKey(form.playlistName);
  const accentPreview = useMemo(() => normalizeAccentHex(form.accent), [form.accent]);

  function close() {
    setOpen(false);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError(null);
    setCreated(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const minRows = Number.parseInt(form.minRows, 10);
    const body = {
      label:
        form.labelMode === "existing"
          ? { mode: "existing", label_key: form.existingLabel }
          : {
              mode: "new",
              display_name: form.labelName,
              label_key: form.labelKey.trim() || undefined,
              accent_hex: form.accent.trim() || undefined,
            },
      playlist: {
        display_name: form.playlistName,
        playlist_key: form.playlistKey.trim() || undefined,
        spotify_playlist: form.spotifyPlaylist,
        sot_playlist: form.sotPlaylist,
        sot_dashboard_url: form.sotDashboardUrl,
        sot_dashboard_name: form.sotDashboardName.trim() || undefined,
        min_rows: Number.isFinite(minRows) ? minRows : undefined,
      },
    };
    try {
      const res = await fetch("/api/competitors/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        if (json?.fields) setErrors(json.fields as FieldErrors);
        else setFormError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      setCreated(json.data as Created);
      router.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Add competitor
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Add competitor playlist"
        subtitle="Starts tracking on the next scheduled competitor pipeline run. No migration or CSV edit needed."
        maxWidthClassName="max-w-2xl"
      >
        {created ? (
          <div className="space-y-3 text-sm" style={{ color: "var(--sb-text)" }}>
            <Alert variant="success" title="Saved">
              {created.created_label ? "New label " : "Label "}
              <code>{created.label_key}</code> with playlist <code>{created.playlist_key}</code>.
            </Alert>
            <p>What happens next (UTC):</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>05:23: competitor playlist refresh picks it up from the database.</li>
              <li>08:53: dashboard sync fills the SpotOnTrack dashboard with the playlist&apos;s tracks.</li>
              <li>11:29: export + ingestion; first totals appear. Daily deltas need two snapshots.</li>
            </ol>
            <p style={{ color: "var(--sb-muted)" }}>
              To start sooner, run those three competitor workflows manually in GitHub Actions, in that order.
              {created.created_label && !accentPreview
                ? " The label gets an accent from its artwork once thumbnails refresh and extract-competitor-accents runs."
                : ""}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setCreated(null); setForm(EMPTY_FORM); }}>
                Add another
              </Button>
              <Button variant="primary" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            {formError ? (
              <Alert variant="error" title="Couldn't save">
                {formError}
              </Alert>
            ) : null}

            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
                Label
              </legend>
              <div className="flex gap-2">
                {(["new", "existing"] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="xs"
                    variant={form.labelMode === mode ? "primary" : "secondary"}
                    onClick={() => set("labelMode")(mode)}
                  >
                    {mode === "new" ? "New label" : "Existing label"}
                  </Button>
                ))}
              </div>
              {form.labelMode === "existing" ? (
                <Field label="Label" error={errors["label.label_key"]}>
                  <Select value={form.existingLabel} onChange={(e) => set("existingLabel")(e.target.value)} required>
                    <option value="">Choose a label…</option>
                    {labels.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Label name" error={errors["label.display_name"]}>
                    <Input value={form.labelName} onChange={(e) => set("labelName")(e.target.value)} placeholder="Lilly Era" required />
                  </Field>
                  <Field
                    label="Label key"
                    error={errors["label.label_key"]}
                    hint={derivedLabelKey ? <code>{derivedLabelKey}</code> : "Derived from the name"}
                  >
                    <Input value={form.labelKey} onChange={(e) => set("labelKey")(e.target.value)} placeholder={derivedLabelKey || "lilly_era"} />
                  </Field>
                  <Field label="Accent (optional)" error={errors["label.accent_hex"]} hint="Blank = from artwork">
                    <div className="flex items-center gap-2">
                      <Input value={form.accent} onChange={(e) => set("accent")(e.target.value)} placeholder="#FF6B35" />
                      <span
                        className="h-7 w-7 shrink-0 rounded-lg sb-ring"
                        style={{ background: accentPreview ? `#${accentPreview}` : "transparent" }}
                        aria-hidden
                      />
                    </div>
                  </Field>
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-2 text-sm font-semibold" style={{ color: "var(--sb-text)" }}>
                Playlist
              </legend>
              <p className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
                In SpotOnTrack, open the playlist and create an empty dashboard for it first. The three links below
                come from there.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Playlist name" error={errors["playlist.display_name"]}>
                  <Input value={form.playlistName} onChange={(e) => set("playlistName")(e.target.value)} placeholder="Lilly Era Releases" required />
                </Field>
                <Field
                  label="Playlist key"
                  error={errors["playlist.playlist_key"]}
                  hint={derivedPlaylistKey ? <code>{derivedPlaylistKey}</code> : "Derived from the name"}
                >
                  <Input value={form.playlistKey} onChange={(e) => set("playlistKey")(e.target.value)} placeholder={derivedPlaylistKey || "lilly_era_releases"} />
                </Field>
                <Field label="Spotify playlist link" error={errors["playlist.spotify_playlist"]}>
                  <Input value={form.spotifyPlaylist} onChange={(e) => set("spotifyPlaylist")(e.target.value)} placeholder="https://open.spotify.com/playlist/…" required />
                </Field>
                <Field label="SpotOnTrack playlist link" error={errors["playlist.sot_playlist"]}>
                  <Input value={form.sotPlaylist} onChange={(e) => set("sotPlaylist")(e.target.value)} placeholder="https://www.spotontrack.com/playlists/spotify/…" required />
                </Field>
                <Field label="SpotOnTrack dashboard link" error={errors["playlist.sot_dashboard_url"]}>
                  <Input value={form.sotDashboardUrl} onChange={(e) => set("sotDashboardUrl")(e.target.value)} placeholder="https://www.spotontrack.com/dashboard/…" required />
                </Field>
                <Field label="Dashboard name in SpotOnTrack" error={errors["playlist.sot_dashboard_name"]} hint="Blank = playlist name">
                  <Input value={form.sotDashboardName} onChange={(e) => set("sotDashboardName")(e.target.value)} placeholder={form.playlistName || "Lilly Era Releases"} />
                </Field>
                <Field label="Minimum export rows" error={errors["playlist.min_rows"]} hint="Export fails below this (safety)">
                  <Input type="number" min={0} value={form.minRows} onChange={(e) => set("minRows")(e.target.value)} />
                </Field>
              </div>
            </fieldset>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                Add competitor
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
