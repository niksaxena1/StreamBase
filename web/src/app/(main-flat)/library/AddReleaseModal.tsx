"use client";

import { useState, useTransition } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { validateNewRelease, type NewReleaseDraft } from "@/lib/library/edits";
import type { LibraryEntity, LibraryRow } from "@/lib/library/types";

import { createLibraryTrack } from "./library.actions";
import { DistributorCombobox, EntitySelect, Field } from "./LibraryEditForm";

function emptyDraft(entities: LibraryEntity[]): NewReleaseDraft {
  const preferred = entities.find((e) => e.code === "tg" && e.active) ?? entities.find((e) => e.active) ?? entities[0];
  return {
    entity: preferred?.code ?? "tg",
    sheet_artist: "",
    sheet_title: "",
    release_date: "",
    distributor_account: "",
  };
}

function AddReleaseForm({
  entities,
  distributors,
  onClose,
  onCreated,
}: {
  entities: LibraryEntity[];
  distributors: string[];
  onClose: () => void;
  onCreated: (catalogId: string, row: LibraryRow | null) => void;
}) {
  const [draft, setDraft] = useState<NewReleaseDraft>(() => emptyDraft(entities));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const errors = validateNewRelease(draft);
  const shown = submitted ? errors : {};
  const set = <K extends keyof NewReleaseDraft>(key: K, value: NewReleaseDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function submit() {
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(errors).length > 0) return;
    startTransition(async () => {
      try {
        const result = await createLibraryTrack(draft);
        if (result.ok) onCreated(result.catalogId, result.row);
        else setServerError(result.error);
      } catch (error) {
        setServerError(error instanceof Error ? error.message : "Couldn't add the release");
      }
    });
  }

  return (
    <form
      // Tall enough that the distributor dropdown isn't clipped by the modal body.
      className="flex min-h-[22rem] flex-col gap-4"
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
        <Field label="Distributor" full>
          <DistributorCombobox
            distributors={distributors}
            value={draft.distributor_account}
            onChange={(v) => set("distributor_account", v)}
          />
        </Field>
      </div>

      {serverError ? (
        <Alert variant="error" title="Couldn't add the release">
          {serverError}
        </Alert>
      ) : null}

      <div className="mt-auto flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          Add release
        </Button>
      </div>
    </form>
  );
}

export function AddReleaseModal({
  open,
  entities,
  distributors,
  onClose,
  onCreated,
}: {
  open: boolean;
  entities: LibraryEntity[];
  distributors: string[];
  onClose: () => void;
  onCreated: (catalogId: string, row: LibraryRow | null) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add release" maxWidthClassName="max-w-xl">
      {/* Mounted only while open, so the form starts empty each time. */}
      <AddReleaseForm entities={entities} distributors={distributors} onClose={onClose} onCreated={onCreated} />
    </Modal>
  );
}
