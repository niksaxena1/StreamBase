export type CompetitorLabel = {
  label_key: string;
  display_name: string;
};

export const ALL_COMPETITORS_KEY = "__all__";

/** Lime accent for all-competitors mode (matches default `--sb-accent` in globals.css). */
export const ALL_COMPETITORS_ACCENT_HEX = "c7f33c";

export function isAllCompetitorsKey(value: unknown): boolean {
  return typeof value === "string" && value.trim() === ALL_COMPETITORS_KEY;
}

export function resolveCompetitorLabelKey(
  savedLabelKey: unknown,
  labels: CompetitorLabel[],
): string | null {
  const activeKeys = new Set(labels.map((label) => label.label_key));
  const saved = typeof savedLabelKey === "string" ? savedLabelKey.trim() : "";
  if (saved === ALL_COMPETITORS_KEY) return ALL_COMPETITORS_KEY;
  if (saved && activeKeys.has(saved)) return saved;
  return labels.length ? ALL_COMPETITORS_KEY : null;
}
