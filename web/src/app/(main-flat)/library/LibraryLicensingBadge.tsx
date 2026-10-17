import { licensingBatches, licensingDate, licensingStatusLabel, type LibraryLicense } from "@/lib/library/licensing";

export function LibraryLicensingBadge({ licensing, licensee }: { licensing: LibraryLicense[]; licensee: string }) {
  const batches = licensingBatches(licensing, licensee);
  const newest = batches[0];
  if (!newest) return null;
  const color = newest.status === "sent" ? "var(--sb-positive)" : "var(--sb-warning)";
  const tooltip = batches.map((batch) => `${batch.pack} · ${licensingDate(batch.batch_date)} · ${licensingStatusLabel(batch.status)}${batch.status_on ? ` (${licensingDate(batch.status_on)})` : ""}`).join("\n");
  return <span title={tooltip} className="inline-block max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums"
    style={{ color, borderColor: color, background: newest.status === "sent" ? "color-mix(in srgb, var(--sb-positive) 12%, transparent)" : "transparent" }}>
    {licensingDate(newest.batch_date)} · {licensingStatusLabel(newest.status)}
  </span>;
}
