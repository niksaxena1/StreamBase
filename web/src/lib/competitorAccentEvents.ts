export const COMPETITOR_ACCENT_EVENT = "sb:competitor-accent";
export const COMPETITOR_LABEL_EVENT = "sb:competitor-label";

export type CompetitorAccentEventDetail = {
  accentHex: string | null;
  labelKey: string | null;
};

export function dispatchCompetitorAccent(detail: CompetitorAccentEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPETITOR_ACCENT_EVENT, { detail }));
}

export function dispatchCompetitorLabelChange(detail: CompetitorAccentEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COMPETITOR_LABEL_EVENT, { detail }));
  dispatchCompetitorAccent(detail);
}
