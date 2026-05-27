"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { TableCell, TableRow } from "@/components/ui/GlassTable";
import type { CompetitorWarningRow } from "@/lib/health/competitor/types";

function severityClass(severity: string): string {
  if (severity === "critical") return "bg-red-500/20 text-red-700 dark:text-red-300";
  if (severity === "warn") return "bg-amber-500/20 text-amber-700 dark:text-amber-300";
  return "bg-white/10 text-[var(--sb-muted)]";
}

function extractIsrcList(details: Record<string, unknown> | null): string[] {
  if (!details) return [];
  const raw = details.isrc_list ?? details.isrcs ?? details.tracks;
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v)).filter(Boolean);
  }
  return [];
}

export function CompetitorWarningTable({ rows }: { rows: CompetitorWarningRow[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (!rows.length) {
    return null;
  }

  return (
    <>
      {rows.map((warning) => {
        const isrcs = extractIsrcList(warning.details_json);
        const expanded = expandedId === warning.id;
        const canExpand = isrcs.length > 0 || Boolean(warning.details_json);

        return (
          <TableRow key={warning.id}>
            <TableCell className="w-8">
              {canExpand ? (
                <button
                  type="button"
                  className="rounded p-0.5 opacity-60 hover:opacity-100"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : warning.id)}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
              ) : null}
            </TableCell>
            <TableCell mono className="text-xs whitespace-nowrap">
              {warning.created_at ? new Date(warning.created_at).toLocaleString() : "—"}
            </TableCell>
            <TableCell>
              <div className="min-w-0">
                {warning.playlist_key ? (
                  <Link
                    href={`/playlists?playlist_key=${encodeURIComponent(warning.playlist_key)}`}
                    className="block truncate font-medium sb-link-hover"
                  >
                    {warning.playlist_display_name ?? warning.playlist_key}
                  </Link>
                ) : (
                  "—"
                )}
                {warning.label_display_name ? (
                  <div className="truncate text-[10px] opacity-60">{warning.label_display_name}</div>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <span
                className={[
                  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                  severityClass(warning.severity),
                ].join(" ")}
              >
                {warning.severity}
              </span>
            </TableCell>
            <TableCell mono className="text-xs">
              {warning.code}
            </TableCell>
            <TableCell>
              <div className="text-xs">{warning.message}</div>
              {expanded && isrcs.length > 0 ? (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px] opacity-80">
                  {isrcs.slice(0, 50).map((isrc) => (
                    <li key={isrc}>
                      <Link href={`/tracks/${encodeURIComponent(isrc)}`} className="sb-link-hover font-mono">
                        {isrc}
                      </Link>
                    </li>
                  ))}
                  {isrcs.length > 50 ? (
                    <li className="opacity-60">…and {isrcs.length - 50} more</li>
                  ) : null}
                </ul>
              ) : null}
              {expanded && !isrcs.length && warning.details_json ? (
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-black/20 p-2 text-[10px]">
                  {JSON.stringify(warning.details_json, null, 2)}
                </pre>
              ) : null}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}
