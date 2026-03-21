/** UAE standard time (Abu Dhabi, Dubai, etc.) */
const ABU_DHABI_TZ = "Asia/Dubai";

/**
 * Human-readable date + time in Abu Dhabi for display on shared snapshot pages.
 */
export function formatShareSnapshotCreatedAtAbuDhabi(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  if (Number.isNaN(d.getTime())) return createdAtIso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ABU_DHABI_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
