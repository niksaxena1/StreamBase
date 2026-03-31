"use client";

import { Disc3 } from "lucide-react";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { Modal } from "@/components/ui/Modal";
import type { SharedTrack } from "./page";
import { NetworkCatalogRoutedLink } from "./NetworkCatalogLinks";

export function SharedTracksListModal({
  open,
  onClose,
  title,
  tracks,
  onTrackOpenDetail,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  tracks: SharedTrack[];
  /** Plain click on track title → track detail modal (same as frozen edge tooltip). */
  onTrackOpenDetail: (isrc: string, displayName: string) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Shared tracks"
      subtitle={title}
      maxWidthClassName="max-w-lg"
    >
      <ul className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pr-1 text-sm">
        {tracks.map((t, i) => (
          <li key={`${t.isrc}-${i}`} className="flex max-w-full items-center gap-2">
            {t.album_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.album_image_url}
                alt=""
                className="h-8 w-8 shrink-0 rounded object-cover"
              />
            ) : (
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/10"
                aria-hidden
              >
                <Disc3 className="h-4 w-4 opacity-40" />
              </span>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <NetworkCatalogRoutedLink
                href={`/catalog?isrc=${encodeURIComponent(t.isrc)}`}
                className="sb-link-hover min-w-0 flex-1 truncate font-medium"
                title="Click: track details · Ctrl/⌘+click or long-press: Catalog"
                onPrimaryAction={() =>
                  onTrackOpenDetail(t.isrc, String(t.name ?? t.isrc))
                }
              >
                {t.name ?? t.isrc}
              </NetworkCatalogRoutedLink>
              <CopyableIsrc
                inline
                isrc={t.isrc}
                className="shrink-0 font-mono text-[10px] opacity-70 hover:opacity-100"
                style={{ color: "var(--sb-muted)" }}
                title="Copy ISRC"
              />
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
