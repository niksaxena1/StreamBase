"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { licensingDate, licensingPackChoices, type LibraryLicenseDetail, type LicensingStatus } from "@/lib/library/licensing";
import { fetchLibraryLicensing, setLibraryPackTrackStatus } from "./library.actions";

export function LibraryBulkLicensing({ selectedIds, disabled, onDone }: { selectedIds: string[]; disabled: boolean; onDone: (updated: number) => void }) {
  const [status, setStatus] = useState<LicensingStatus | null>(null);
  const [batches, setBatches] = useState<LibraryLicenseDetail[] | null>(null);
  const [packId, setPackId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choices = status ? licensingPackChoices(batches ?? [], selectedIds, status) : [];
  const choice = choices.find((pack) => String(pack.pack_id) === packId);
  const count = choice?.changeIds.length ?? 0;

  function open(next: LicensingStatus) {
    setStatus(next);
    setBatches(null);
    setPackId("");
    setError(null);
    startTransition(async () => {
      try {
        const result = await fetchLibraryLicensing(selectedIds);
        if (!result.ok) { setError(result.error); return; }
        setBatches(result.batches);
        setPackId(result.batches[0] ? String(result.batches[0].pack_id) : "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load batches");
      }
    });
  }

  function apply() {
    if (!choice || !status || !count) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setLibraryPackTrackStatus(choice.pack_id, choice.changeIds, status);
        if (!result.ok) { setError(result.error); return; }
        setStatus(null);
        onDone(result.updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't update licensing");
      }
    });
  }

  return <>
    <Button size="xs" variant="secondary" disabled={disabled || pending} onClick={() => open("sent")}>Mark sent…</Button>
    <Button size="xs" variant="secondary" disabled={disabled || pending} onClick={() => open("staged")}>Mark staged…</Button>
    <Modal open={status !== null} onClose={() => { if (!pending) setStatus(null); }} title={`Mark ${status ?? "sent"}`} maxWidthClassName="max-w-md" showCloseButton={false}>
      {batches === null && pending ? <p className="text-sm" role="status">Loading batches…</p> : null}
      {choices.length ? <>
        <label className="block space-y-1 text-xs">Batch
          <Select value={packId} disabled={pending} onChange={(e) => setPackId(e.target.value)}>
            {choices.map((pack) => <option key={pack.pack_id} value={pack.pack_id}>{pack.licensee} · {pack.pack} · {licensingDate(pack.batch_date)}</option>)}
          </Select>
        </label>
        <p className="mt-3 text-sm">Mark {count.toLocaleString("en-US")} {count === 1 ? "release" : "releases"} {status} in {choice?.pack}?</p>
        <p className="mt-2 text-xs" style={{ color: "var(--sb-muted)" }}>{choice?.memberIds.length ?? 0} of {selectedIds.length} selected releases belong to this batch. Releases already {status} keep their status date. Each change is logged.</p>
      </> : batches !== null ? <p className="text-sm">None of the selected releases are in a batch.</p> : null}
      {error ? <p role="alert" className="mt-2 text-xs" style={{ color: "var(--sb-error)" }}>{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => setStatus(null)}>Cancel</Button>
        <Button variant="accent" loading={pending} disabled={!count || disabled} onClick={apply}>Confirm {count.toLocaleString("en-US")} {count === 1 ? "release" : "releases"}</Button>
      </div>
    </Modal>
  </>;
}
