"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { dropboxHomeUrl, safeExternalUrl } from "@/lib/library/format";
import { licensingDate, licensingStatusLabel, type LibraryLicenseDetail, type LicensingStatus } from "@/lib/library/licensing";
import { Section } from "./LibraryDetailSections";
import { setLibraryPackTrackStatus, type LibrarySaveResult } from "./library.actions";

export function LibraryLicensingSection({ batches, onSaved }: {
  batches: LibraryLicenseDetail[];
  onSaved: (result: Extract<LibrarySaveResult, { ok: true }>) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function change(batch: LibraryLicenseDetail, status: LicensingStatus) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setLibraryPackTrackStatus(batch.pack_id, [batch.catalog_id], status);
        if (result.ok) onSaved(result);
        else setError(result.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't update licensing");
      }
    });
  }
  return <Section title="Licensing">
    {batches.length === 0 ? <p className="text-xs" style={{ color: "var(--sb-muted)" }}>Not in a batch</p> : (
      <ul className="space-y-3">
        {batches.map((batch) => {
          const link = safeExternalUrl(batch.shared_link) ?? (batch.dropbox_path ? dropboxHomeUrl(batch.dropbox_path) : null);
          return <li key={batch.pack_id} className="space-y-1 text-xs">
            <p className="font-medium">{batch.licensee} · {batch.pack}</p>
            <p style={{ color: "var(--sb-muted)" }}>Batch {licensingDate(batch.batch_date)} · {licensingStatusLabel(batch.status)}{batch.status_on ? ` on ${licensingDate(batch.status_on)}` : ""}</p>
            <div className="flex items-center gap-1">
              {(["staged", "sent"] as const).map((status) => <Button key={status} size="xs" variant={batch.status === status ? "accent" : "secondary"}
                aria-pressed={batch.status === status} aria-label={`Mark ${batch.pack} ${status}`} disabled={pending || batch.status === status} onClick={() => change(batch, status)}>
                {licensingStatusLabel(status)}
              </Button>)}
              {link ? <a href={link} target="_blank" rel="noopener noreferrer" className="ml-2 underline">Dropbox</a> : null}
            </div>
          </li>;
        })}
      </ul>
    )}
    {error ? <p role="alert" className="mt-2 text-xs" style={{ color: "var(--sb-error)" }}>{error}</p> : null}
  </Section>;
}
