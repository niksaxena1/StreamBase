export const APP_SHORT_NAME = "StreamBase";
export const APP_AI_SHORT_NAME = "StreamBase AI";

export function formatPageTitle(title?: string | null) {
  const cleanTitle = (title ?? "").trim();
  return cleanTitle || APP_SHORT_NAME;
}
