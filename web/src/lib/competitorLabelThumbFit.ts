/**
 * Optional object-position nudges for square Spotify covers cropped to circles.
 * Default 50% 50% is correct for most playlist art; use this only when the logo
 * sits off-center inside the square file. Regenerate: cd web && npx tsx scripts/analyze-competitor-thumb-fit.ts
 */
export const COMPETITOR_LABEL_THUMB_OBJECT_POSITION: Record<string, string> = {
  atlast: "50% 50%",
  chillyourmind: "50% 50%",
  paraiso: "44% 44%",
  selected: "50% 62%",
  soave: "48% 50%",
};

export function competitorLabelThumbObjectPosition(labelKey: string | null | undefined): string {
  if (!labelKey) return "50% 50%";
  return COMPETITOR_LABEL_THUMB_OBJECT_POSITION[labelKey] ?? "50% 50%";
}
