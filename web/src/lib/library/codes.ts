const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const UPC_RE = /^\d{12,13}$/;

/** Uppercase, strip spaces and dashes. */
export function normalizeIsrc(input: string | null | undefined): string {
  return (input ?? "").toUpperCase().replace(/[\s-]/g, "");
}

export function isValidIsrc(normalized: string): boolean {
  return ISRC_RE.test(normalized);
}

/** Strip spaces and dashes. */
export function normalizeUpc(input: string | null | undefined): string {
  return (input ?? "").replace(/[\s-]/g, "");
}

export function isValidUpc(normalized: string): boolean {
  return UPC_RE.test(normalized);
}

/** Error text for an ISRC field, or null when empty or valid. */
export function isrcError(input: string): string | null {
  const n = normalizeIsrc(input);
  if (!n) return null;
  return isValidIsrc(n) ? null : "ISRC should look like USABC2600123";
}

/** Error text for a UPC field, or null when empty or valid. */
export function upcError(input: string): string | null {
  const n = normalizeUpc(input);
  if (!n) return null;
  return isValidUpc(n) ? null : "UPC should be 12 or 13 digits";
}
