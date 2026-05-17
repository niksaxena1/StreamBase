export type CompetitorLabel = {
  label_key: string;
  display_name: string;
};

export function resolveCompetitorLabelKey(
  savedLabelKey: unknown,
  labels: CompetitorLabel[],
): string | null {
  const activeKeys = new Set(labels.map((label) => label.label_key));
  const saved = typeof savedLabelKey === "string" ? savedLabelKey.trim() : "";
  if (saved && activeKeys.has(saved)) return saved;
  return labels[0]?.label_key ?? null;
}
