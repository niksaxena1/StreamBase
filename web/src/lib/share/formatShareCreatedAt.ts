import { formatDisplayDate } from "@/lib/format";
/** UAE standard time (Abu Dhabi, Dubai, etc.) */
const ABU_DHABI_TZ = "Asia/Dubai";

/**
 * Human-readable date + time in Abu Dhabi for display on shared snapshot pages.
 */
export function formatShareSnapshotCreatedAtAbuDhabi(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  if (Number.isNaN(d.getTime())) return createdAtIso;
  const date = formatDisplayDate(new Intl.DateTimeFormat("en-CA", { timeZone: ABU_DHABI_TZ }).format(d));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: ABU_DHABI_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${date}, ${time} GST`;
}
