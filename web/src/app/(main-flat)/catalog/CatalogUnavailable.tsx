import { Alert } from "@/components/ui/Alert";
import type { CatalogTrackSelection } from "@/lib/catalogSelection";

import type { TrackRow } from "./catalogPageUtils";

export function CatalogTrackUnavailable(props: {
  datasetMode: "own" | "competitor";
  isrc: string;
  reason: Extract<CatalogTrackSelection<TrackRow>, { kind: "unavailable" }>["reason"];
}) {
  const copy =
    props.reason === "not_active"
      ? {
          title: "Historical track is not currently tracked",
          body: `ISRC ${props.isrc} exists in competitor history but is not active in the selected competitor's latest snapshot.`,
        }
      : props.reason === "missing_artist_metadata"
        ? {
            title: "Track is missing artist metadata",
            body: `ISRC ${props.isrc} exists, but it cannot be opened in Catalog until an artist mapping is available.`,
          }
        : {
            title: "Track unavailable",
            body: `ISRC ${props.isrc} was not found in ${props.datasetMode === "competitor" ? "the selected competitor" : "Own Catalog"}. The search result or bookmark may be stale.`,
          };

  return (
    <div className="space-y-4">
      <Alert variant="warning" title={copy.title}>
        {copy.body}
      </Alert>
    </div>
  );
}

export function CatalogArtistUnavailable(props: {
  datasetMode: "own" | "competitor";
  artistId: string;
  /** First available artist in the current universe, offered as a way out (the
   * remembered-artist redirect can land here after switching competitors). */
  fallbackHref?: string | null;
}) {
  return (
    <div className="space-y-4">
      <Alert variant="warning" title="Artist unavailable">
        Artist {props.artistId} was not found in {props.datasetMode === "competitor" ? "the selected competitor" : "Own Catalog"}.
        {props.fallbackHref ? (
          <>
            {" "}
            <a href={props.fallbackHref} className="underline underline-offset-2">
              Open the first available artist instead
            </a>
            .
          </>
        ) : null}
      </Alert>
    </div>
  );
}
