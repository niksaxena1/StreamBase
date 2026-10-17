export type LicensingStatus = "staged" | "sent";
export type LicensingFilter = "" | "any" | LicensingStatus | "none";
export type LibraryLicense = {
  licensee: string;
  pack: string;
  batch_date: string | null;
  status: LicensingStatus;
  status_on: string | null;
};
export type LibraryLicenseDetail = LibraryLicense & {
  pack_id: number;
  catalog_id: string;
  dropbox_path: string | null;
  shared_link: string | null;
};

function date(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Broken JSON and invalid entries never prevent the library from rendering. */
export function parseLicensing(raw: unknown): LibraryLicense[] {
  try {
    const items: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item): LibraryLicense[] => {
      if (!item || typeof item !== "object") return [];
      const r = item as Record<string, unknown>;
      if (typeof r.licensee !== "string" || !r.licensee.trim() || typeof r.pack !== "string" || !r.pack.trim()) return [];
      if (r.status !== "staged" && r.status !== "sent") return [];
      const batchDate = date(r.batch_date);
      if (r.batch_date != null && !batchDate) return [];
      return [{ licensee: r.licensee.trim(), pack: r.pack, batch_date: batchDate, status: r.status, status_on: date(r.status_on) }];
    }).sort((a, b) => (b.batch_date ?? "").localeCompare(a.batch_date ?? ""));
  } catch {
    return [];
  }
}

export function licensingBatches(licensing: readonly LibraryLicense[], licensee: string): LibraryLicense[] {
  return licensing.filter((b) => b.licensee.toLowerCase() === licensee.toLowerCase());
}

export function parseLicensingFilter(raw: unknown): LicensingFilter {
  return raw === "any" || raw === "staged" || raw === "sent" || raw === "none" ? raw : "";
}

/** Status filters describe the newest batch, just like the table badge. */
export function matchesLicensing(licensing: readonly LibraryLicense[], licensee: string, filter: LicensingFilter): boolean {
  if (!filter) return true;
  const newest = licensingBatches(licensing, licensee)[0];
  if (filter === "none") return !newest;
  return !!newest && (filter === "any" || newest.status === filter);
}

export function licensingDate(value: string | null): string {
  return value ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(2, 4)}` : "Undated";
}

export function licensingStatusLabel(status: LicensingStatus): string {
  return status === "sent" ? "Sent" : "Staged";
}

export function licensingCsv(licensing: readonly LibraryLicense[], licensee: string): string {
  const batch = licensingBatches(licensing, licensee)[0];
  return batch ? `${licensingDate(batch.batch_date)} ${licensingStatusLabel(batch.status)}` : "";
}

export type LicensingPackChoice = LibraryLicense & { pack_id: number; memberIds: string[]; changeIds: string[] };

/** One choice per pack, even when selected tracks have different statuses in that pack. */
export function licensingPackChoices(batches: LibraryLicenseDetail[], selectedIds: string[], status: LicensingStatus): LicensingPackChoice[] {
  const selected = new Set(selectedIds);
  const packs = new Map<number, LicensingPackChoice>();
  for (const batch of batches) {
    if (!selected.has(batch.catalog_id)) continue;
    let choice = packs.get(batch.pack_id);
    if (!choice) {
      choice = { ...batch, memberIds: [], changeIds: [] };
      packs.set(batch.pack_id, choice);
    }
    if (!choice.memberIds.includes(batch.catalog_id)) choice.memberIds.push(batch.catalog_id);
    if (batch.status !== status && !choice.changeIds.includes(batch.catalog_id)) choice.changeIds.push(batch.catalog_id);
  }
  return [...packs.values()];
}
