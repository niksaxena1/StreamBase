import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { latestOwnRunDate, loadDistroMovementCached } from "@/lib/collectors/distroMovement";
import { OUTSIDE_TRACKED_SET } from "@/lib/rosterFlow";
import { formatInt } from "@/lib/format";

/**
 * One-line pointer to the Collectors distro-movement section, rendered only
 * when tracks actually changed distribution recently. Distro migrations are
 * bursty, so on quiet days this renders nothing rather than an empty section.
 */
export async function DistroMovementHomeNotice() {
  let moved = 0;
  try {
    const runDate = await latestOwnRunDate();
    if (!runDate) return null;
    const { data } = await loadDistroMovementCached({ runDate, windowDays: 30 });
    if (!data) return null;

    const importSet = new Set(data.import_targets);
    moved = data.flows
      .filter(
        (flow) =>
          !(flow.source === OUTSIDE_TRACKED_SET && importSet.has(flow.target)) &&
          (flow.source !== OUTSIDE_TRACKED_SET || flow.target !== OUTSIDE_TRACKED_SET),
      )
      .reduce((sum, flow) => sum + flow.track_count, 0);
  } catch {
    // Never let the notice break Home.
    return null;
  }
  if (moved <= 0) return null;

  return (
    <div
      className="rounded-xl border p-3 text-sm"
      style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
    >
      <Link href="/collectors" className="group inline-flex flex-wrap items-center gap-1.5">
        <span className="font-mono">{formatInt(moved)}</span>
        <span>
          {moved === 1 ? "track" : "tracks"} changed distribution in the last 30 days — re-distributions,
          new uploads, or takedowns.
        </span>
        <span
          className="inline-flex items-center gap-1 font-medium underline-offset-2 group-hover:underline"
          style={{ color: "var(--sb-accent)" }}
        >
          View distro movement
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>
    </div>
  );
}
