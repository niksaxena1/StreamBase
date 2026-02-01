export type SearchParamsLike = { toString(): string };

export function patchSearchParams(
  existing: SearchParamsLike | string,
  patch: Record<string, string | null | undefined>,
) {
  const u = new URLSearchParams(typeof existing === "string" ? existing : existing.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") u.delete(k);
    else u.set(k, v);
  }
  return u;
}

export function hrefWithPatchedSearchParams(
  existing: SearchParamsLike | string,
  patch: Record<string, string | null | undefined>,
  opts?: { prefix?: string },
) {
  const prefix = opts?.prefix ?? "?";
  const u = patchSearchParams(existing, patch);
  return `${prefix}${u.toString()}`;
}

