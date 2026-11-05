import { isPlaylistWatchOnlyAccess, type AppAccess } from "@/lib/appAccess";

export type CompetitorReleaseSummaryRow = {
  label_key: string;
  release_date: string | null;
  tracks: number;
  prev_streams: number;
  cur_streams: number;
  run_date: string;
};

/** The comparison sits in the own-catalog Home section, so it needs both own-catalog and competitor access. */
export function canCompareCompetitorReleaseWeeks(isAdmin: boolean, appAccess: AppAccess): boolean {
  if (isAdmin) return true;
  if (isPlaylistWatchOnlyAccess(appAccess)) return false;
  return Boolean(appAccess.ownCatalog && appAccess.competitor);
}
