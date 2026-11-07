import { formatDisplayDateTimeUtc } from "@/lib/format";

/**
 * Human-readable UTC date + time ("06 Nov 2026, 20:00 UTC") for shared snapshot pages.
 * Unparseable input is returned unchanged.
 */
export function formatShareSnapshotCreatedAt(createdAtIso: string): string {
  const out = formatDisplayDateTimeUtc(createdAtIso);
  return out === "—" ? createdAtIso : out;
}
