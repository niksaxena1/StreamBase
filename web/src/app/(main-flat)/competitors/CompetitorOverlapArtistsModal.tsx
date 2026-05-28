"use client";

import Link from "next/link";
import { User } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatInt } from "@/lib/format";

import type { OverlapArtistRow } from "./competitorsTypes";

export function CompetitorOverlapArtistsModal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  artists: OverlapArtistRow[];
  loading: boolean;
  error: string | null;
}) {
  const { open, onClose, title, subtitle, artists, loading, error } = props;

  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} maxWidthClassName="max-w-lg">
      {loading ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          Loading shared artists…
        </p>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : artists.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          No shared artists found for this pair.
        </p>
      ) : (
        <p className="mb-3 text-xs" style={{ color: "var(--sb-muted)" }}>
          {formatInt(artists.length)} shared {artists.length === 1 ? "artist" : "artists"}
        </p>
      )}
      {!loading && !error && artists.length > 0 ? (
        <ul className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pr-1 text-sm">
          {artists.map((a) => (
            <li key={a.artist_id} className="flex max-w-full items-center gap-2">
              {a.image_url ? (
                <PreviewableArtwork
                  src={a.image_url}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full object-cover sb-ring"
                  label={a.artist_name}
                />
              ) : (
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 sb-ring"
                  aria-hidden
                >
                  <User className="h-4 w-4 opacity-40" />
                </span>
              )}
              <Link
                href={`/artists/${encodeURIComponent(a.artist_id)}`}
                className="sb-link-hover min-w-0 flex-1 truncate font-medium"
              >
                {a.artist_name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
