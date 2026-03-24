"use client";

import Link from "next/link";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Disc3, ExternalLink, Loader2, Music, UserRound } from "lucide-react";
import { formatDateISO } from "@/lib/format";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { Modal } from "@/components/ui/Modal";
import { NetworkCatalogArtistLink } from "./NetworkCatalogLinks";
import type { IsrcDetailPayload } from "./networkIsrcDetail";
import { useNetworkMetricStreams } from "./useNetworkMetricStreams";

function ModalDistroPlaylistLink({
  playlistKey,
  name,
  imageUrl,
  onPrimaryNavigate,
}: {
  playlistKey: string;
  name: string;
  imageUrl: string | null;
  onPrimaryNavigate?: () => void;
}) {
  const router = useRouter();
  const href = `/playlists?playlist_key=${encodeURIComponent(playlistKey)}`;
  return (
    <Link
      href={href}
      className="flex max-w-[148px] min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      style={{ borderColor: "var(--sb-border)", color: "var(--sb-text)" }}
      title={`${name} · Click: open playlist · Ctrl/⌘+click: new tab`}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        onPrimaryNavigate?.();
        router.push(href);
      }}
    >
      {imageUrl ? (
        <NextImage
          src={imageUrl}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded object-cover sb-ring"
        />
      ) : (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded sb-ring bg-white/60 dark:bg-white/10"
          aria-hidden
        >
          <Music className="h-3.5 w-3.5 opacity-45" />
        </div>
      )}
      <span className="min-w-0 flex-1 truncate font-medium leading-tight">{name}</span>
    </Link>
  );
}

export function FrozenEdgeTrackDetailModal({
  open,
  onClose,
  isrc,
  fallbackTitle,
  onFocusArtistOnNetwork,
}: {
  open: boolean;
  onClose: () => void;
  isrc: string | null;
  fallbackTitle: string;
  /** Plain click on an artist link: close modal and focus this artist on the network graph. */
  onFocusArtistOnNetwork?: (artistId: string) => void;
}) {
  const { formatFromStreamCount, totalColumnLabel, dailyColumnLabel, metricColor } = useNetworkMetricStreams();
  const [detail, setDetail] = useState<IsrcDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !isrc) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/admin/isrc-batch-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isrcs: [isrc] }),
    })
      .then((res) => res.json())
      .then((j: { tracks?: IsrcDetailPayload[]; error?: string }) => {
        if (cancelled) return;
        if (j.error) {
          setDetail(null);
          setError(j.error);
          return;
        }
        const t = j.tracks?.find((x) => x.isrc === isrc) ?? null;
        setDetail(t ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
          setError("Failed to load track details");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isrc]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayTitle = ((detail?.name ?? fallbackTitle).trim() || isrc || "Track") as string;
  const spotifyUrl =
    detail?.spotify_track_id && String(detail.spotify_track_id).trim() !== ""
      ? `https://open.spotify.com/track/${detail.spotify_track_id}`
      : null;
  const distroText = (detail?.distroPlaylists ?? "").trim();
  const distroRows = detail?.distroPlaylistDetails;
  const artistRows = detail?.trackArtists;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={displayTitle}
      subtitle={
        isrc ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="opacity-80">ISRC</span>
            <span className="opacity-40" aria-hidden>
              ·
            </span>
            <CopyableIsrc isrc={isrc} className="font-mono text-[11px] opacity-95" />
          </span>
        ) : undefined
      }
      maxWidthClassName="max-w-lg"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm opacity-70" style={{ color: "var(--sb-muted)" }}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : error ? (
        <div className="text-sm" style={{ color: "var(--sb-error)" }}>
          {error}
        </div>
      ) : (
        <div className="space-y-4 text-sm" style={{ color: "var(--sb-text)" }}>
          {/* Art + metrics (left) · release + distro (right) — stacks on narrow viewports */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex min-w-0 gap-3">
              {detail?.spotify_album_image_url ? (
                <NextImage
                  src={detail.spotify_album_image_url}
                  alt=""
                  width={72}
                  height={72}
                  className="h-[72px] w-[72px] shrink-0 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-lg sb-ring bg-white/60 dark:bg-white/10">
                  <Disc3 className="h-8 w-8 opacity-40" aria-hidden />
                </div>
              )}
              <div className="min-w-0 space-y-2">
                <div>
                  <div
                    className="text-[10px] font-medium uppercase tracking-wide opacity-70"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    {totalColumnLabel}
                  </div>
                  <div
                    className="mt-0.5 font-mono text-lg font-semibold tabular-nums leading-tight"
                    style={{ color: metricColor }}
                  >
                    {formatFromStreamCount(detail?.totalStreams)}
                  </div>
                </div>
                <div>
                  <div
                    className="text-[10px] font-medium uppercase tracking-wide opacity-70"
                    style={{ color: "var(--sb-muted)" }}
                  >
                    {dailyColumnLabel}
                  </div>
                  <div
                    className="mt-0.5 font-mono text-base font-semibold tabular-nums leading-tight"
                    style={{ color: metricColor }}
                  >
                    {formatFromStreamCount(detail?.dailyStreams)}
                  </div>
                </div>
              </div>
            </div>
            <div
              className="min-w-0 flex-1 space-y-2.5 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0"
              style={{ borderColor: "var(--sb-border)" }}
            >
              <div>
                <div
                  className="text-[10px] font-medium uppercase tracking-wide opacity-70"
                  style={{ color: "var(--sb-muted)" }}
                >
                  Release date
                </div>
                <div className="mt-0.5 font-mono text-xs tabular-nums">
                  {detail?.release_date ? formatDateISO(detail.release_date) : "—"}
                </div>
              </div>
              <div className="space-y-1.5">
                <div
                  className="text-[10px] font-medium uppercase tracking-wide opacity-70"
                  style={{ color: "var(--sb-muted)" }}
                >
                  Distro playlists
                </div>
                {distroRows && distroRows.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {distroRows.map((p) => (
                      <ModalDistroPlaylistLink
                        key={p.key}
                        playlistKey={p.key}
                        name={p.name}
                        imageUrl={p.imageUrl}
                        onPrimaryNavigate={onClose}
                      />
                    ))}
                  </div>
                ) : distroText ? (
                  <div className="whitespace-pre-wrap break-words text-[11px] leading-snug opacity-90">
                    {distroText}
                  </div>
                ) : (
                  <div className="text-[11px] opacity-70">—</div>
                )}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div
              className="text-[11px] font-medium uppercase tracking-wide opacity-70"
              style={{ color: "var(--sb-muted)" }}
            >
              Artists
            </div>
            {artistRows && artistRows.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {artistRows.map((a) => (
                  <div key={a.id} className="flex w-[96px] flex-col items-center gap-1">
                    {a.imageUrl ? (
                      <NextImage
                        src={a.imageUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 shrink-0 rounded-full object-cover sb-ring"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full sb-ring bg-white/60 dark:bg-white/10">
                        <UserRound className="h-4 w-4 opacity-40" aria-hidden />
                      </div>
                    )}
                    <NetworkCatalogArtistLink
                      artistId={a.id}
                      title="Click: focus on network graph · Ctrl/⌘+click or long-press: Catalog"
                      onNetworkSelectArtist={(id) => {
                        onClose();
                        onFocusArtistOnNetwork?.(id);
                      }}
                      className="w-full truncate text-center text-[11px] font-semibold hover:underline"
                    >
                      {a.name}
                    </NetworkCatalogArtistLink>
                  </div>
                ))}
              </div>
            ) : detail?.artistsOnTrack ? (
              <div className="text-xs leading-snug opacity-90">{detail.artistsOnTrack}</div>
            ) : (
              <div className="text-xs opacity-70">—</div>
            )}
          </div>
          {spotifyUrl ? (
            <a
              href={spotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium underline underline-offset-2 opacity-90 hover:opacity-100"
              style={{ color: "var(--sb-accent)" }}
            >
              Open in Spotify
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </a>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
