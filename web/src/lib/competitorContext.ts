export type CompetitorLabel = {
  label_key: string;
  display_name: string;
};

export const ALL_COMPETITORS_KEY = "__all__";

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
