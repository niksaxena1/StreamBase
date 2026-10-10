/** Counter animation maths (StreamBase AnimatedCounter pattern: ease-out cubic, ~650 ms). */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Value at progress t in [0, 1]. Always lands exactly on `to`, so the final text is exact. */
export function valueAt(from: number, to: number, t: number): number {
  if (t >= 1) return to;
  if (t <= 0) return from;
  return from + (to - from) * easeOutCubic(t);
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  } catch {
    return false;
  }
}
