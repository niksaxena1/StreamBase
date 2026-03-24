import { formatInt } from "@/lib/format";

export function PlaylistMembershipStats(props: {
  trackCount: number | null;
  artistCount: number | null;
  className?: string;
}) {
  const showTrack = props.trackCount != null && Number.isFinite(props.trackCount);
  const showArtist = props.artistCount != null && Number.isFinite(props.artistCount);
  if (!showTrack && !showArtist) return null;

  const trackN = showTrack ? Math.trunc(Number(props.trackCount)) : 0;
  const artistN = showArtist ? Math.trunc(Number(props.artistCount)) : 0;

  return (
    <div
      className={["flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", props.className].filter(Boolean).join(" ")}
      style={{ color: "var(--sb-muted)" }}
      aria-label="Playlist size"
    >
      {showTrack ? (
        <span>
          <span className="font-mono tabular-nums" style={{ color: "var(--sb-text)" }}>
            {formatInt(trackN)}
          </span>{" "}
          tracks
        </span>
      ) : null}
      {showTrack && showArtist ? (
        <span className="opacity-40" aria-hidden>
          ·
        </span>
      ) : null}
      {showArtist ? (
        <span>
          <span className="font-mono tabular-nums" style={{ color: "var(--sb-text)" }}>
            {formatInt(artistN)}
          </span>{" "}
          artists
        </span>
      ) : null}
    </div>
  );
}
