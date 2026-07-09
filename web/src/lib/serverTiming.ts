import { SB_TIMING_SLOW_MS_DEFAULT } from "@/lib/constants";
import { logDebug } from "@/lib/logger";

export function isTimingEnvEnabled(value: string | undefined | null): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function shouldLogServerTiming(args: {
  enabled: boolean;
  durationMs: number;
  thresholdMs: number;
}): boolean {
  return args.enabled && args.durationMs >= Math.max(0, args.thresholdMs);
}

function isServerTimingEnabled(): boolean {
  return isTimingEnvEnabled(process.env.SB_TIMING ?? process.env.SOT_TIMING);
}

function serverTimingThresholdMs(): number {
  const raw = process.env.SB_TIMING_SLOW_MS ?? String(SB_TIMING_SLOW_MS_DEFAULT);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : SB_TIMING_SLOW_MS_DEFAULT;
}

export async function timedServerStep<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { thresholdMs?: number },
): Promise<T> {
  const enabled = isServerTimingEnabled();
  if (!enabled) return await fn();

  const thresholdMs = opts?.thresholdMs ?? serverTimingThresholdMs();
  const t0 = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - t0;
    if (shouldLogServerTiming({ enabled, durationMs, thresholdMs })) {
      logDebug(`serverStep key=${label} ms=${durationMs.toFixed(1)} error=no`);
    }
    return result;
  } catch (error) {
    const durationMs = performance.now() - t0;
    if (shouldLogServerTiming({ enabled, durationMs, thresholdMs: 0 })) {
      logDebug(`serverStep key=${label} ms=${durationMs.toFixed(1)} error=throw`);
    }
    throw error;
  }
}
