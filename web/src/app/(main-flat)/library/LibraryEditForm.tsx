"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Combobox } from "@/components/ui/Combobox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  buildTrackChanges,
  draftFromRow,
  validateDraft,
  type LibraryDraft,
} from "@/lib/library/edits";
import {
  LIBRARY_EXCLUSIVITY_OPTIONS,
  LIBRARY_ORIGINALITY_OPTIONS,
  type LibraryEntity,
  type LibraryRow,
} from "@/lib/library/types";

import { saveLibraryTrack, type LibrarySaveResult } from "./library.actions";

export const FIELD_CLASS = [
  "sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none dark:bg-white/5",
  "placeholder:text-black/40 dark:placeholder:text-white/40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
].join(" ");

export function Field({
  label,
  error,
  full,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={["block space-y-1", full ? "sm:col-span-2" : ""].join(" ")}>
      <span className="text-xs font-medium">{label}</span>
      {children}
      {error ? (
        <span className="block text-[11px]" style={{ color: "var(--sb-error)" }} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** Keeps a value that isn't in the preset list (e.g. typed by hand elsewhere) selectable. */
export function withCurrent(options: readonly string[], current: string): string[] {
  return current && !options.includes(current) ? [...options, current] : [...options];
}

export function EntitySelect({
  entities,
  value,
  onChange,
}: {
  entities: LibraryEntity[];
  value: string;
  onChange: (code: string) => void;
}) {
  const list = entities.filter((e) => e.active || e.code === value);
  const known = list.some((e) => e.code === value);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Entity">
      {!value ? <option value="">Pick an entity</option> : null}
      {!known && value ? <option value={value}>{value.toUpperCase()}</option> : null}
      {list.map((e) => (
        <option key={e.code} value={e.code}>
          {e.name}
        </option>
      ))}
    </Select>
  );
}

export function DistributorCombobox({
  distributors,
  value,
  onChange,
  ariaLabel = "Distributor",
}: {
  distributors: string[];
  value: string;
  onChange: (name: string) => void;
  ariaLabel?: string;
}) {
  const options = useMemo(() => {
    const names = value && !distributors.includes(value) ? [value, ...distributors] : distributors;
    return [{ value: "", label: "None" }, ...names.map((n) => ({ value: n, label: n }))];
  }, [distributors, value]);
  return (
    <div className="sb-ring rounded-xl bg-white/70 px-3 py-2 dark:bg-white/5">
      <Combobox
        value={value}
        options={options}
        ariaLabel={ariaLabel}
        placeholder="Search distributors"
        showThumbnails={false}
        onChange={onChange}
      />
    </div>
  );
}

export function LibraryEditForm({
  row,
  entities,
  distributors,
  onCancel,
  onSaved,
}: {
  row: LibraryRow;
  entities: LibraryEntity[];
  distributors: string[];
  onCancel: () => void;
  onSaved: (result: Extract<LibrarySaveResult, { ok: true }>) => void;
}) {
  const [draft, setDraft] = useState<LibraryDraft>(() => draftFromRow(row));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const errors = validateDraft(draft, row);
  const shown = submitted ? errors : {};
  const set = <K extends keyof LibraryDraft>(key: K, value: LibraryDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function submit() {
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length > 0) return;
    const changes = buildTrackChanges(row, draft);
    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }
    startTransition(async () => {
      try {
        const result = await saveLibraryTrack(row.catalog_id, changes);
        if (result.ok) onSaved(result);
        else setServerError(result.error);
      } catch (error) {
        setServerError(error instanceof Error ? error.message : "Couldn't save");
      }
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Entity" error={shown.entity}>
          <EntitySelect entities={entities} value={draft.entity} onChange={(v) => set("entity", v)} />
        </Field>
        <Field label="Release date" error={shown.release_date}>
          <Input type="date" value={draft.release_date} onChange={(e) => set("release_date", e.target.value)} />
        </Field>
        <Field label="Artist" error={shown.sheet_artist}>
          <Input value={draft.sheet_artist} onChange={(e) => set("sheet_artist", e.target.value)} />
        </Field>
        <Field label="Title" error={shown.sheet_title}>
          <Input value={draft.sheet_title} onChange={(e) => set("sheet_title", e.target.value)} />
        </Field>
        <Field label="Distributor">
          <DistributorCombobox
            distributors={distributors}
            value={draft.distributor_account}
            onChange={(v) => set("distributor_account", v)}
          />
        </Field>
        <Field label="Label / Genre">
          <Input value={draft.label_genre} onChange={(e) => set("label_genre", e.target.value)} />
        </Field>
        <Field label="Originality">
          <Select value={draft.originality} onChange={(e) => set("originality", e.target.value)}>
            <option value="">—</option>
            {withCurrent(LIBRARY_ORIGINALITY_OPTIONS, draft.originality).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Exclusivity">
          <Select value={draft.exclusivity} onChange={(e) => set("exclusivity", e.target.value)}>
            <option value="">—</option>
            {withCurrent(LIBRARY_EXCLUSIVITY_OPTIONS, draft.exclusivity).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cover original artist">
          <Input value={draft.cover_original_artist} onChange={(e) => set("cover_original_artist", e.target.value)} />
        </Field>
        <Field label="Genre">
          <Input value={draft.genre} onChange={(e) => set("genre", e.target.value)} />
        </Field>
        <Field label="New distro">
          <Input value={draft.new_distro} onChange={(e) => set("new_distro", e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--sb-accent-stroke)]"
            checked={draft.non_exclusive_samples}
            onChange={(e) => set("non_exclusive_samples", e.target.checked)}
          />
          Splice samples
        </label>
        <Field label="ISRC" error={shown.isrc}>
          <Input
            className="font-mono"
            value={draft.isrc}
            placeholder="USABC2600123"
            autoComplete="off"
            onChange={(e) => set("isrc", e.target.value)}
          />
        </Field>
        <Field label="UPC" error={shown.upc}>
          <Input
            className="font-mono"
            value={draft.upc}
            placeholder="12 or 13 digits"
            autoComplete="off"
            inputMode="numeric"
            onChange={(e) => set("upc", e.target.value)}
          />
        </Field>
        <Field label="Comment 1" full>
          <textarea
            className={FIELD_CLASS}
            rows={2}
            value={draft.comment_1}
            onChange={(e) => set("comment_1", e.target.value)}
          />
        </Field>
        <Field label="Comment 2" full>
          <textarea
            className={FIELD_CLASS}
            rows={2}
            value={draft.comment_2}
            onChange={(e) => set("comment_2", e.target.value)}
          />
        </Field>
      </div>

      {serverError ? (
        <Alert variant="error" title="Couldn't save">
          {serverError}
        </Alert>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
