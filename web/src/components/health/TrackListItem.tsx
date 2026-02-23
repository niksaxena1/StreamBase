import Link from "next/link";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import type { TrackBase } from "@/lib/health/types";

/**
 * Shared track rendering used across all expandable warning sections.
 *
 * Two layouts are supported via the `compact` prop:
 *  - default: name + artists inline (flex-wrap), used by most warning types.
 *  - compact: name and artists on separate truncated lines, used by
 *    drift / overlap sections that have a card background.
 */
export function TrackListItem({
  track,
  thumbOverrides,
  compact,
  align = "center",
  inlineExtra,
  actions,
  trailing,
  className,
  style,
}: {
  track: TrackBase;
  thumbOverrides?: Record<string, string | null>;
  compact?: boolean;
  align?: "center" | "start";
  inlineExtra?: React.ReactNode;
  actions?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const isrc = (track.isrc ?? "").trim().toUpperCase();
  const overrideUrl = thumbOverrides?.[isrc];
  const imageUrl =
    overrideUrl !== undefined ? overrideUrl : (track.album_image_url ?? null);

  return (
    <div
      className={[
        "flex gap-3 text-xs",
        align === "start" ? "items-start" : "items-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Album cover"
          className="h-10 w-10 rounded object-cover sb-ring flex-shrink-0"
        />
      ) : (
        <div className="h-10 w-10 rounded sb-ring bg-white/60 flex-shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        {compact ? (
          <>
            <div className="truncate">
              <Link
                href={`/tracks/${track.isrc}`}
                className="font-medium hover:underline"
                style={{ color: "var(--sb-text)" }}
              >
                {track.name || track.isrc}
              </Link>
            </div>
            {track.artist_names && track.artist_names.length > 0 && (
              <div className="opacity-60 truncate mt-0.5">
                <ArtistLinks
                  artistNames={track.artist_names}
                  artistIds={track.artist_ids ?? undefined}
                />
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/tracks/${track.isrc}`}
              className="font-medium hover:underline"
              style={{ color: "var(--sb-text)" }}
            >
              {track.name || track.isrc}
            </Link>
            {track.artist_names && track.artist_names.length > 0 && (
              <span className="opacity-60">
                by{" "}
                <ArtistLinks
                  artistNames={track.artist_names}
                  artistIds={track.artist_ids ?? undefined}
                />
              </span>
            )}
            {inlineExtra}
          </div>
        )}

        <div className="mt-0.5 flex items-center gap-2">
          <Link
            href={`/tracks/${track.isrc}`}
            className="font-mono text-[10px] sb-positive underline hover:opacity-80"
          >
            {track.isrc}
          </Link>
          {actions}
        </div>
      </div>

      {trailing}
    </div>
  );
}
