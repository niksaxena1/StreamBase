"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { BULK_FIELDS, buildBulkChanges, bulkConfirmText, type BulkFieldKey } from "@/lib/library/bulk";
import type { LibraryEntity } from "@/lib/library/types";

import { DistributorCombobox, EntitySelect } from "./LibraryEditForm";
import type { FilterOptionLists } from "./LibraryFilters";
import { bulkUpdateLibraryTracks } from "./library.actions";
import { LibraryBulkLicensing } from "./LibraryBulkLicensing";

const UNSET = "__unset";
const CLEAR = "__clear";

/**
 * Sticky bar shown while releases are selected in the list. `value` is null until a value is chosen;
 * an empty string means "clear the field".
 */
export function LibraryBulkBar({
  selectedIds,
  entities,
  distributors,
  options,
  onClear,
  onDone,
}: {
  selectedIds: string[];
  entities: LibraryEntity[];
  distributors: string[];
  options: FilterOptionLists;
  onClear: () => void;
  /** Called after a fully successful update, with the number of releases that changed. */
  onDone: (updated: number) => void;
}) {
  const listId = useId();
  const [field, setField] = useState<BulkFieldKey>("entity");
  const [value, setValue] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const count = selectedIds.length;
  const spec = BULK_FIELDS.find((f) => f.key === field)!;
  const changes = value === null ? null : buildBulkChanges(field, value);
  const displayValue =
    value === null || value === ""
      ? ""
      : field === "entity"
        ? (entities.find((e) => e.code === value)?.name ?? value.toUpperCase())
        : value;

  function chooseField(next: BulkFieldKey) {
    setField(next);
    setValue(null);
    setError(null);
  }

  function apply() {
    if (!changes) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await bulkUpdateLibraryTracks(selectedIds, changes);
        if (result.ok) {
          setConfirmOpen(false);
          onDone(result.updated);
        } else {
          setConfirmOpen(false);
          setError(result.error);
        }
      } catch (e) {
        setConfirmOpen(false);
        setError(e instanceof Error ? e.message : "Couldn't update the releases");
      }
    });
  }

  const optionSelect = (list: string[], label: string) => (
    <Select
      aria-label={label}
      className="w-auto min-w-[10rem] py-1.5 text-xs"
      value={value === null ? UNSET : value === "" ? CLEAR : value}
      onChange={(e) => setValue(e.target.value === UNSET ? null : e.target.value === CLEAR ? "" : e.target.value)}
    >
      <option value={UNSET}>Choose a value</option>
      {list.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value={CLEAR}>Clear value</option>
    </Select>
  );

  return (
    <div
      className="sb-card sticky top-2 z-20 flex flex-wrap items-center gap-2 px-3 py-2 text-xs shadow-lg"
      role="region"
      aria-label="Bulk edit"
    >
      <span className="font-medium tabular-nums">{count.toLocaleString("en-US")} selected</span>

      <Select
        aria-label="Field to change"
        className="w-auto py-1.5 text-xs"
        value={field}
        onChange={(e) => chooseField(e.target.value as BulkFieldKey)}
      >
        {BULK_FIELDS.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>

      <div className="min-w-[10rem]">
        {field === "entity" ? (
          <EntitySelect entities={entities} value={value ?? ""} onChange={(code) => setValue(code || null)} />
        ) : field === "distributor_account" ? (
          <DistributorCombobox distributors={distributors} value={value ?? ""} onChange={setValue} ariaLabel="New distributor" />
        ) : field === "label_genre" ? (
          <span className="inline-flex items-center gap-1.5">
            <Input
              aria-label="New label / genre"
              placeholder="Type or pick a value"
              list={listId}
              className="w-48 py-1.5 text-xs"
              value={value ?? ""}
              onChange={(e) => setValue(e.target.value)}
            />
            <datalist id={listId}>
              {options.labelGenres.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            <Button type="button" size="sm" variant="ghost" onClick={() => setValue("")}>
              Clear value
            </Button>
          </span>
        ) : field === "originality" ? (
          optionSelect(options.originalities, "New originality")
        ) : (
          optionSelect(options.exclusivities, "New exclusivity")
        )}
      </div>

      <Button variant="accent" disabled={!changes || pending} onClick={() => setConfirmOpen(true)}>
        Apply
      </Button>
      <Button variant="ghost" onClick={onClear} disabled={pending}>
        Clear selection
      </Button>
      <LibraryBulkLicensing selectedIds={selectedIds} disabled={pending} onDone={onDone} />

      {error ? (
        <span role="alert" style={{ color: "var(--sb-error)" }}>
          {error}
        </span>
      ) : null}

      <Modal
        open={confirmOpen}
        onClose={() => (pending ? undefined : setConfirmOpen(false))}
        title="Confirm change"
        maxWidthClassName="max-w-md"
        showCloseButton={false}
      >
        <p className="text-sm">{bulkConfirmText(field, displayValue, count)}</p>
        <p className="mt-2 text-xs" style={{ color: "var(--sb-muted)" }}>
          Each release gets its own entry in the change history.
          {spec.clearable ? "" : " Entity can't be left empty."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="accent" loading={pending} onClick={apply}>
            Apply to {count.toLocaleString("en-US")} {count === 1 ? "release" : "releases"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
