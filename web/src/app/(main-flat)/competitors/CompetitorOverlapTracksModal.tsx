"use client";

import Link from "next/link";
import { Disc3 } from "lucide-react";

import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { Modal } from "@/components/ui/Modal";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatInt } from "@/lib/format";

import type { OverlapTrackRow } from "./competitorsTypes";

export function CompetitorOverlapTracksModal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  tracks: OverlapTrackRow[];
  loading: boolean;
  error: string | null;
}) {
  const { open, onClose, title, subtitle, tracks, loading, error } = props;

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} maxWidthClassName="max-w-lg">
      {loading ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          Loading shared tracks…
        </p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : tracks.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          No shared tracks found for this pair.
        </p>
      ) : (
        <p className="mb-3 text-xs" style={{ color: "var(--sb-muted)" }}>
          {formatInt(tracks.length)} shared {tracks.length === 1 ? "track" : "tracks"}
        </p>
      )}
      {!loading && !error && tracks.length > 0 ? (
        <ul className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pr-1 text-sm">
          {tracks.map((t) => (
            <li key={t.isrc} className="flex max-w-full items-start gap-2">
              {t.album_image_url ? (
                <PreviewableArtwork
                  src={t.album_image_url}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded object-cover sb-ring"
                  label={t.name}
                />
              ) : (
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/10 sb-ring"
                  aria-hidden
                >
                  <Disc3 className="h-4 w-4 opacity-40" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={`/tracks/${encodeURIComponent(t.isrc)}`}
                    className="sb-link-hover min-w-0 flex-1 truncate font-medium"
                  >
                    {t.name}
                  </Link>
                  <CopyableIsrc
                    inline
                    isrc={t.isrc}
                    className="shrink-0 font-mono text-[10px] opacity-70 hover:opacity-100"
                    style={{ color: "var(--sb-muted)" }}
                    title="Copy ISRC"
                  />
                </div>
                {t.artist_names?.length ? (
                  <div className="truncate text-[10px] opacity-60">
                    <ArtistLinks artistNames={t.artist_names} artistIds={null} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
