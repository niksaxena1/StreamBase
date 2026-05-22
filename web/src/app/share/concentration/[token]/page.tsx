import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import React from "react";

import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { parseConcentrationShareSnapshotV1 } from "@/lib/share/concentrationSnapshot";
import { formatShareSnapshotCreatedAtAbuDhabi } from "@/lib/share/formatShareCreatedAt";
import { CONCENTRATION_SHARE_TTL_DAYS } from "@/lib/share/concentrationShareTtl";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ token: string }> };

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { token } = await props.params;
  return {
    title: "Shared concentration",
    robots: { index: false, follow: false },
    openGraph: { url: `/share/concentration/${token}` },
  };
}

export default async function SharedConcentrationPage(props: PageProps) {
  const { token } = await props.params;
  if (!token || token.length > 200) notFound();

  const nowIso = new Date().toISOString();
  const svc = supabaseService();
  const { data, error } = await svc
    .from("concentration_share_snapshots")
    .select("snapshot, created_at")
    .eq("token", token)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (error || !data?.snapshot) notFound();

  const createdAtIso =
    typeof data.created_at === "string" && data.created_at.trim() ? data.created_at.trim() : null;

  const snap = parseConcentrationShareSnapshotV1(data.snapshot);
  if (!snap) notFound();

  await svc.from("concentration_share_snapshots").delete().lt("expires_at", nowIso);

  const isRevenue = snap.metric === "revenue";
  const formatValue = (streams: number) =>
    isRevenue ? formatUsd(streams * snap.streamPayoutPerStreamUsd) : formatInt(streams);
  const valueStyle = isRevenue ? ({ color: "#10b981" } as const) : ({ color: "var(--sb-positive)" } as const);
  const valueClass = "font-medium";
  const valueHeader =
    isRevenue
      ? snap.viewMode === "daily"
        ? "DAILY REV"
        : "TOTAL REV"
      : snap.viewMode === "daily"
        ? "DAILY"
        : "TOTAL";

  const tracksAboveThreshold = snap.tracksAboveThreshold;
  const thresholdIdx = snap.thresholdIdx;

  return (
    <div className="min-h-dvh" style={{ background: "var(--sb-bg)", color: "var(--sb-text)" }}>
      <main id="main-content" className="mx-auto max-w-5xl px-4 py-8 space-y-4">
        <header className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider opacity-50">StreamBase · shared snapshot</p>
          <h1 className="text-lg font-semibold">{snap.title}</h1>
          <p className="text-sm opacity-60">{snap.subtitle}</p>
          {createdAtIso ? (
            <p className="text-xs opacity-50" style={{ color: "var(--sb-muted)" }}>
              Snapshot created{" "}
              <span className="font-mono tabular-nums">
                {formatShareSnapshotCreatedAtAbuDhabi(createdAtIso)}
              </span>{" "}
              <span className="opacity-70">(Abu Dhabi)</span>
            </p>
          ) : null}
          {snap.latestRunDate ? (
            <p className="text-xs font-mono opacity-40">Run date {snap.latestRunDate}</p>
          ) : null}
          <p className="text-xs opacity-40">Read-only · links and filters are disabled</p>
          <p className="text-xs opacity-40">
            This snapshot expires {CONCENTRATION_SHARE_TTL_DAYS} days after it was created and is then deleted.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--sb-muted)" }}>
          <span className="rounded-full border px-2 py-0.5 sb-ring" style={{ borderColor: "var(--sb-border)" }}>
            {snap.viewMode === "daily" ? "Daily" : "Total"} · {snap.metric === "revenue" ? "Revenue" : "Streams"}
          </span>
          <span className="rounded-full border px-2 py-0.5 sb-ring" style={{ borderColor: "var(--sb-border)" }}>
            Threshold {snap.threshold}%
          </span>
          <span>{snap.rowCount} tracks</span>
        </div>

        <GlassTable
          headers={[
            "",
            "TRACK",
            { label: "RELEASE", className: "hidden sm:table-cell" },
            {
              label: <span className="uppercase tracking-wider">{snap.showIsrcColumn ? "ISRC" : "DISTRO"}</span>,
              className: "hidden sm:table-cell",
            },
            { label: valueHeader, align: "right" as const },
            { label: "SHARE", align: "right" as const },
            { label: "CUM %", align: "right" as const },
          ]}
          maxBodyHeightClassName="max-h-[70vh]"
        >
          {snap.rows.length === 0 ? (
            <EmptyState colSpan={7} message="No tracks in snapshot" />
          ) : (
            snap.rows.map((p, i) => {
              const val = Math.max(0, p.valueStreams);
              const isThresholdRow = i === thresholdIdx;
              const isAboveThreshold =
                thresholdIdx >= 0 && i <= thresholdIdx && tracksAboveThreshold < snap.rows.length;

              return (
                <React.Fragment key={p.isrc}>
                  <TableRow
                    style={
                      isAboveThreshold
                        ? { backgroundColor: "color-mix(in srgb, var(--sb-positive) 6%, transparent)" }
                        : undefined
                    }
                  >
                    <TableCell>
                      {p.album_image_url ? (
                        <Image
                          src={p.album_image_url}
                          alt={p.name ?? p.isrc}
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-lg object-cover sb-ring flex-shrink-0"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <span className="font-medium block truncate">{p.name ?? p.isrc}</span>
                        {p.artist_names?.length ? (
                          <div className="text-[10px] opacity-50 truncate">{p.artist_names.join(", ")}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell mono className="text-xs hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                      {formatDateISO(p.release_date ?? null)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {snap.showIsrcColumn ? (
                        <CopyableIsrc
                          isrc={p.isrc}
                          className="font-mono text-xs opacity-40"
                          style={{ color: "var(--sb-muted)" }}
                        />
                      ) : p.distroPlaylistName ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          {p.distroPlaylistImageUrl ? (
                            <Image
                              src={p.distroPlaylistImageUrl}
                              alt={p.distroPlaylistName}
                              width={20}
                              height={20}
                              className="h-5 w-5 rounded flex-shrink-0 object-cover"
                            />
                          ) : (
                            <div className="h-5 w-5 rounded flex-shrink-0 bg-orange-400/20" />
                          )}
                          <span className="truncate text-xs" style={{ color: "var(--sb-muted)" }}>
                            {p.distroPlaylistName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell numeric className={valueClass} style={valueStyle}>
                      {snap.viewMode === "daily" ? `+${formatValue(val)}` : formatValue(val)}
                    </TableCell>
                    <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)", opacity: 0.7 }}>
                      {p.sharePct.toFixed(1)}%
                    </TableCell>
                    <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)" }}>
                      {p.cumPct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                  {isThresholdRow && tracksAboveThreshold < snap.rows.length && (
                    <tr aria-hidden>
                      <td colSpan={7} className="px-2 py-0">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                          <span className="text-[10px] font-medium" style={{ color: "var(--sb-positive)", opacity: 0.7 }}>
                            {snap.threshold}% of {snap.viewMode === "daily" ? "daily" : "total"} streams above
                          </span>
                          <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </GlassTable>

        {snap.rows.length > 0 &&
        thresholdIdx >= 0 &&
        tracksAboveThreshold < snap.rows.length &&
        snap.rows[thresholdIdx] ? (
          <p className="text-center text-[10px] opacity-50" style={{ color: "var(--sb-muted)" }}>
            Highlighted rows: top {tracksAboveThreshold} tracks account for {snap.threshold}% of{" "}
            {snap.viewMode === "daily" ? "daily" : "total"} streams in this snapshot
          </p>
        ) : null}
      </main>
    </div>
  );
}
