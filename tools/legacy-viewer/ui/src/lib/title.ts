import { useEffect } from "react";

export const APP_TITLE = "Legacy Archive";
/** "Dreams — Joongle · Legacy Archive". Empty parts are dropped. */
export function windowTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((p): p is string => !!p && !!p.trim()), APP_TITLE].join(" · ");
}
export const trackTitle = (song: string, artist: string) => `${song} — ${artist}`;
/** Pages that name their own window call this; App leaves their title alone (see TITLED_PAGES). */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
export const TITLED_PAGES = ["lookup", "artist-report"];
