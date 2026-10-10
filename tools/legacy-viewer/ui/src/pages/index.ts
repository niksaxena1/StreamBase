import type { ComponentType } from "react";
import OverviewPage from "./Overview";
import LookupPage from "./Lookup";
import ArtistReportPage from "./ArtistReport";
import TracksPage from "./Tracks";
import ArtistsPage from "./Artists";
import PlaylistsPage from "./Playlists";
import MilestonesPage from "./Milestones";
import TaxPage from "./Tax";
import FollowersPage from "./Followers";
import OriginalDashboardsPage from "./OriginalDashboards";
import DataQualityPage from "./DataQuality";
import ArchivePage from "./Archive";
import TrackDetail from "./TrackDetail";
import ArtistDetail from "./ArtistDetail";
import PlaylistDetail from "./PlaylistDetail";
import FollowerPlaylist from "./FollowerPlaylist";
export const pageComponents: Record<string, ComponentType> = {
  lookup: LookupPage,
  "artist-report": ArtistReportPage,
  overview: OverviewPage,
  tracks: TracksPage,
  track: TrackDetail,
  artists: ArtistsPage,
  artist: ArtistDetail,
  playlists: PlaylistsPage,
  playlist: PlaylistDetail,
  milestones: MilestonesPage,
  tax: TaxPage,
  followers: FollowersPage,
  "follower-playlist": FollowerPlaylist,
  "original-dashboards": OriginalDashboardsPage,
  original: OriginalDashboardsPage,
  "data-quality": DataQualityPage,
  quality: DataQualityPage,
  archive: ArchivePage,
};
