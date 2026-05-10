export const APP_SHORT_NAME = "SBase";

export function formatPageTitle(title?: string | null) {
  const cleanTitle = (title ?? "").trim();
  return cleanTitle || APP_SHORT_NAME;
}
