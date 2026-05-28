/**
 * Canonical competitor label accent colors: raw DB/fallback → batch harmonize → pinned brands.
 * Apply at every load boundary so UI, charts, and --sb-accent share one resolved hex per label.
 */

import { harmonizeAccentBatch } from "@/lib/competitorAccentPalette";

export const FALLBACK_LABEL_COLORS = [
  "#2563EB",
  "#EA580C",
  "#E11D48",
  "#7C3AED",
  "#059669",
  "#D97706",
] as const;

/** Brand-locked accents; never shifted by harmonize (matches extract-competitor-accents). */
export const PINNED_LABEL_ACCENTS: Record<string, string> = {
  __own_catalog__: "c7f33c",
  paraiso: "ff9028",
  selected: "db0c0c",
  soave: "b98a46",
};

export type LabelAccentSource = {
  label_key: string;
  accent_hex?: string | null;
};

export function sanitizeAccentHex(accentHex: string | null | undefined): string | null {
  const clean = accentHex?.replace(/^#/, "").toLowerCase();
  if (!clean || !/^[0-9a-f]{6}$/.test(clean)) return null;
  return `#${clean}`;
}

/** Raw 6-char hex (no #) from stored accent or palette fallback. */
export function rawAccentHexForLabel(label: LabelAccentSource, index: number): string {
  const clean = label.accent_hex?.replace(/^#/, "").toLowerCase();
  if (clean && /^[0-9a-f]{6}$/.test(clean)) return clean;
  return FALLBACK_LABEL_COLORS[index % FALLBACK_LABEL_COLORS.length]!.replace(/^#/, "");
}

/** Batch-resolve accents so red-family labels (e.g. ATLAST vs selected.) stay visually distinct. */
export function buildResolvedAccentMap(labels: readonly LabelAccentSource[]): Map<string, string> {
  const raw = new Map<string, string>();
  labels.forEach((label, index) => {
    raw.set(label.label_key, rawAccentHexForLabel(label, index));
  });
  const harmonized = harmonizeAccentBatch(raw);
  for (const [labelKey, hex] of Object.entries(PINNED_LABEL_ACCENTS)) {
    harmonized.set(labelKey, hex.replace(/^#/, "").toLowerCase());
  }
  return harmonized;
}

/** Returns a copy of labels with accent_hex set to the canonical resolved value (no #). */
export function applyResolvedLabelAccents<T extends LabelAccentSource>(labels: readonly T[]): T[] {
  const resolved = buildResolvedAccentMap(labels);
  return labels.map((label, index) => ({
    ...label,
    accent_hex: resolved.get(label.label_key) ?? rawAccentHexForLabel(label, index),
  }));
}

/** CSS color (#rrggbb) for a label key from a resolved map. */
export function resolvedLabelCssColor(
  labelKey: string,
  map: Map<string, string> | Record<string, string>,
  fallbackIndex = 0,
): string {
  const hex =
    map instanceof Map
      ? map.get(labelKey)
      : (map as Record<string, string>)[labelKey];
  if (hex) return `#${hex.replace(/^#/, "")}`;
  return FALLBACK_LABEL_COLORS[fallbackIndex % FALLBACK_LABEL_COLORS.length]!;
}
