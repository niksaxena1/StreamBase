"use client";

import type { CSSProperties } from "react";
import { Disc3, UserRound } from "lucide-react";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import type { GraphEdge, SharedTrack } from "./page";
import { NetworkCatalogArtistLink, NetworkCatalogRoutedLink } from "./NetworkCatalogLinks";
import type { FGNodeObj, FGLinkObj } from "./networkGraphPure";
import { hexToRgba, linkEndpointId } from "./networkGraphPure";

export function NetworkLinkCollaborationTooltipContent({
  link,
  frozen,
  accentColor,
  colors,
  onArtistPrimary,
  onArtistDistroGesture,
  onFrozenTrackOpenDetail,
}: {
  link: FGLinkObj;
  frozen: boolean;
  accentColor: string;
  colors: ThemeColors;
  onArtistPrimary: (artistId: string) => void;
  /** Frozen tooltip: Ctrl/Cmd+click or long-press on artist name → same as Ctrl+click on graph node. */
  onArtistDistroGesture: (artistId: string, artistName: string) => void;
  /** Frozen tooltip: plain click on track title → track detail modal. */
  onFrozenTrackOpenDetail: (isrc: string, displayName: string) => void;
}) {
  const edge = link as unknown as GraphEdge;
  const srcNode = typeof link.source === "object" ? (link.source as FGNodeObj) : null;
  const tgtNode = typeof link.target === "object" ? (link.target as FGNodeObj) : null;
  const srcName = srcNode?.name ?? String(link.source);
  const tgtName = tgtNode?.name ?? String(link.target);
  const srcId = linkEndpointId(link.source);
  const tgtId = linkEndpointId(link.target);
  const tracks = (edge.shared_tracks ?? []) as SharedTrack[];

  const panelStyle: CSSProperties = {
    backgroundColor: colors.card,
    color: colors.text,
    borderColor: frozen ? hexToRgba(accentColor, 0.7) : colors.border,
    boxShadow: frozen
      ? `0 0 0 1px ${hexToRgba(accentColor, 0.7)}, 0 10px 30px ${hexToRgba(accentColor, 0.18)}, var(--sb-shadow-compact)`
      : "var(--sb-shadow-compact)",
    backgroundImage: frozen
      ? `radial-gradient(80% 70% at 25% 20%, ${hexToRgba(accentColor, 0.18)} 0%, transparent 55%), radial-gradient(70% 60% at 85% 85%, ${hexToRgba(accentColor, 0.12)} 0%, transparent 60%)`
      : undefined,
  };

  const artistBlock = (id: string, name: string, imageUrl: string | null | undefined) => (
    <div className="flex min-w-0 max-w-[118px] flex-col items-center gap-1">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Spotify CDN; small tooltip
        <img
          src={imageUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover sb-ring"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full sb-ring bg-white/60 dark:bg-white/10">
          <UserRound className="h-4 w-4 opacity-40" aria-hidden />
        </div>
      )}
      <NetworkCatalogArtistLink
        artistId={id}
        onNetworkSelectArtist={onArtistPrimary}
        onDistroGesture={
          frozen ? () => onArtistDistroGesture(id, name) : undefined
        }
        title={
          frozen
            ? "Click: focus on graph · Ctrl/⌘+click or long-press: distro tracks (same as node)"
            : undefined
        }
        className="w-full truncate text-center text-[11px] font-semibold hover:underline"
      >
        {name}
      </NetworkCatalogArtistLink>
    </div>
  );

  return (
    <div className="rounded-lg border p-3" style={panelStyle}>
      {frozen ? (
        <div className="mb-2 flex items-start justify-center gap-2">
          {artistBlock(srcId, srcName, srcNode?.image_url)}
          <span className="select-none pt-7 text-xs opacity-50" style={{ color: colors.muted }}>
            ×
          </span>
          {artistBlock(tgtId, tgtName, tgtNode?.image_url)}
        </div>
      ) : (
        <div className="text-xs font-semibold" style={{ color: colors.accent }}>
          {srcName} &times; {tgtName}
        </div>
      )}
      <div className={frozen ? "mt-2 text-xs" : "mt-1 text-xs"} style={{ color: colors.muted }}>
        {tracks.length} shared track{tracks.length !== 1 ? "s" : ""}
      </div>
      {tracks.length > 0 ? (
        <ul className="mt-1.5 max-h-[140px] space-y-1 overflow-y-auto text-xs">
          {tracks.slice(0, 10).map((t, i) => (
            <li key={i} className="flex max-w-[280px] items-center gap-2">
              {t.album_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.album_image_url}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded object-cover"
                />
              ) : (
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-white/10"
                  aria-hidden
                >
                  <Disc3 className="h-3 w-3 opacity-40" />
                </span>
              )}
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {frozen ? (
                  <NetworkCatalogRoutedLink
                    href={`/catalog?isrc=${encodeURIComponent(t.isrc)}`}
                    className="sb-link-hover min-w-0 flex-1 truncate font-medium"
                    title="Click: track details · Ctrl/⌘+click or long-press: Catalog"
                    onPrimaryAction={() =>
                      onFrozenTrackOpenDetail(t.isrc, String(t.name ?? t.isrc))
                    }
                  >
                    {t.name ?? t.isrc}
                  </NetworkCatalogRoutedLink>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{t.name ?? t.isrc}</span>
                )}
                <CopyableIsrc
                  inline
                  isrc={t.isrc}
                  className="shrink-0 font-mono text-[9px] opacity-70 hover:opacity-100"
                  style={{ color: colors.muted }}
                  title="Copy ISRC"
                />
              </div>
            </li>
          ))}
          {tracks.length > 10 ? (
            <li style={{ color: colors.muted }}>&hellip; and {tracks.length - 10} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
