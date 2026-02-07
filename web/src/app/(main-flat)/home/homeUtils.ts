import type { PlaylistDailyStatsRow } from "./homeTypes";
import { formatMilestoneCompact, generateAutoMilestonesFromMax as generateAutoMilestonesFromMaxShared } from "@/lib/milestones";
import { AED_PER_USD, getCurrencyDisplay } from "@/lib/format";

// ============================================================================
// Storage keys
// ============================================================================

export const HOME_DETAILS_STORAGE = {
  scatterOpen: "sb:home:details:scatter_open",
  milestoneOpen: "sb:home:details:milestones_open",
  dailyDistOpen: "sb:home:details:daily_dist_open",
  historyOpen: "sb:home:details:history_open",
} as const;

export const HOME_MILESTONE_SETTINGS_STORAGE = {
  customMilestones: "sb:home:milestones:custom_v1",
} as const;

export const HOME_DAILY_BUCKETS_STORAGE = {
  customBuckets: "sb:home:daily_buckets:custom_v1",
} as const;

// ============================================================================
// Milestone parsing
// ============================================================================

export function parseMilestonesText(
  input: string,
  args: { mode: "streams" | "revenue"; payoutPerStreamUsd: number },
): { milestones: number[]; error: string | null } {
  const raw = String(input ?? "").trim();
  if (!raw) return { milestones: [], error: null };

  const parts = raw
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: number[] = [];
  for (const p0 of parts) {
    const cleaned = p0.toLowerCase().trim().replace(/_/g, "").replace(/,/g, "");
    const isUsd = args.mode === "revenue" || cleaned.startsWith("$");
    const p = cleaned.startsWith("$") ? cleaned.slice(1) : cleaned;

    const m = p.match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
    if (!m) return { milestones: [], error: `Invalid milestone: "${p0}"` };

    const n = Number(m[1]);
    if (!Number.isFinite(n)) return { milestones: [], error: `Invalid milestone: "${p0}"` };

    const suffix = (m[2] ?? "").toLowerCase();
    const mult = suffix === "k" ? 1_000 : suffix === "m" ? 1_000_000 : suffix === "b" ? 1_000_000_000 : 1;
    const scaled = n * mult;
    if (!Number.isFinite(scaled) || scaled <= 0) return { milestones: [], error: `Invalid milestone: "${p0}"` };

    const valueStreams = isUsd
      ? (() => {
          const rate = Number(args.payoutPerStreamUsd ?? 0);
          if (!Number.isFinite(rate) || rate <= 0) return NaN;
          return Math.round(scaled / rate);
        })()
      : Math.round(scaled);

    if (!Number.isFinite(valueStreams) || valueStreams <= 0) {
      return {
        milestones: [],
        error: isUsd
          ? "Revenue milestones require a valid payout rate."
          : `Invalid milestone: "${p0}"`,
      };
    }
    if (valueStreams < 100_000) return { milestones: [], error: `Minimum milestone is 100K (got ${p0})` };

    out.push(valueStreams);
  }

  const uniq = Array.from(new Set(out)).sort((a, b) => b - a);
  return { milestones: uniq, error: uniq.length ? null : "Please enter at least one milestone." };
}

// ============================================================================
// Daily bucket parsing
// ============================================================================

export function parseDailyBucketsText(
  input: string,
): { buckets: Array<{ min: number; max: number | null; label: string }>; error: string | null } {
  const raw = String(input ?? "").trim();
  if (!raw) return { buckets: [], error: null };

  const parts = raw
    .split(/[\s,]+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: Array<{ min: number; max: number | null; label: string }> = [];

  for (const p0 of parts) {
    const cleaned = p0.toLowerCase().trim();

    const rangeMatch = cleaned.match(/^(\d+(?:\.\d+)?)(k|m)?[-–](\d+(?:\.\d+)?)(k|m)?$/i);
    const openEndedMatch = cleaned.match(/^(\d+(?:\.\d+)?)(k|m)?\+$/i);

    if (rangeMatch) {
      const minNum = Number(rangeMatch[1]);
      const minSuffix = (rangeMatch[2] ?? "").toLowerCase();
      const minMult = minSuffix === "k" ? 1_000 : minSuffix === "m" ? 1_000_000 : 1;
      const min = minNum * minMult;

      const maxNum = Number(rangeMatch[3]);
      const maxSuffix = (rangeMatch[4] ?? "").toLowerCase();
      const maxMult = maxSuffix === "k" ? 1_000 : maxSuffix === "m" ? 1_000_000 : 1;
      const max = maxNum * maxMult;

      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= min) {
        return { buckets: [], error: `Invalid bucket range: "${p0}"` };
      }

      out.push({ min, max, label: p0 });
    } else if (openEndedMatch) {
      const minNum = Number(openEndedMatch[1]);
      const minSuffix = (openEndedMatch[2] ?? "").toLowerCase();
      const minMult = minSuffix === "k" ? 1_000 : minSuffix === "m" ? 1_000_000 : 1;
      const min = minNum * minMult;

      if (!Number.isFinite(min) || min < 0) {
        return { buckets: [], error: `Invalid bucket: "${p0}"` };
      }

      out.push({ min, max: null, label: p0 });
    } else {
      return { buckets: [], error: `Invalid bucket format: "${p0}". Use ranges like "0-100" or "10K+"` };
    }
  }

  out.sort((a, b) => a.min - b.min);

  for (let i = 0; i < out.length - 1; i++) {
    const curr = out[i];
    const next = out[i + 1];
    if (curr.max === null) {
      return { buckets: [], error: `Open-ended bucket "${curr.label}" must be last` };
    }
    if (curr.max !== next.min) {
      return { buckets: [], error: `Buckets must be continuous: "${curr.label}" ends at ${curr.max} but "${next.label}" starts at ${next.min}` };
    }
  }

  return { buckets: out, error: out.length ? null : "Please enter at least one bucket." };
}

// ============================================================================
// Formatting helpers
// ============================================================================

export function formatMilestoneForInput(n: number): string {
  // Lowercase so users can type "50m, 100k, 2b".
  return formatMilestoneCompact(n, { case: "lower" });
}

export function formatUsdCompact(n: number): string {
  // Keep Home milestone labels consistent with the rest of the app’s currency display setting.
  try {
    const mode = getCurrencyDisplay();
    if (mode === "AED") {
      const aed = n * AED_PER_USD;
      const num = new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: aed < 1000 ? 0 : 1,
      }).format(aed);
      return `AED ${num}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: n < 1000 ? 0 : 1,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
}

export function formatMilestoneHeaderLabel(
  streamsMilestone: number,
  mode: "streams" | "revenue",
  payoutPerStreamUsd: number,
): string {
  if (mode !== "revenue") return formatMilestoneForInput(streamsMilestone).toUpperCase();
  const usd = Math.max(0, streamsMilestone * Math.max(0, payoutPerStreamUsd));
  return formatUsdCompact(usd);
}

export function generateAutoMilestonesFromMax(maxStreams: number): number[] {
  return generateAutoMilestonesFromMaxShared(maxStreams);
}

export function rollSum(
  rowsDesc: PlaylistDailyStatsRow[],
  days: number,
  kind: "streams" | "revenue",
  payoutPerStreamUsd: number,
) {
  const slice = rowsDesc.slice(0, days);
  let sum = 0;
  for (const r of slice) {
    if (kind === "streams") sum += Number(r.daily_streams_net ?? 0);
    else sum += Number(r.daily_streams_net ?? 0) * payoutPerStreamUsd;
  }
  return sum;
}
