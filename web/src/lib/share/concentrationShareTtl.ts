/** Share links stop working after this many days; rows are pruned opportunistically (see API). */
export const CONCENTRATION_SHARE_TTL_DAYS = 7;

export function computeConcentrationShareExpiresAtIso(nowMs: number = Date.now()): string {
  return new Date(nowMs + CONCENTRATION_SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
