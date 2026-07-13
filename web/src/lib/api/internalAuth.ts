import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison for bearer secrets. Hashing both sides first
 * equalizes lengths so `timingSafeEqual` can run (it throws on mismatched
 * lengths, which would itself leak length information).
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (!a || !b) return false;
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}
