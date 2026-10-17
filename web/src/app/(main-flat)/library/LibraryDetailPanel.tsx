"use client";

import { ExternalLink, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Alert } from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDuration, formatReleaseDate, safeExternalUrl } from "@/lib/library/format";
import type { LibraryEntity, LibraryRow, LibraryTrackDetail } from "@/lib/library/types";

import { CodesSection, DriveFolder, FilesSection, HistorySection, Section } from "./LibraryDetailSections";
import { LibraryEditForm } from "./LibraryEditForm";
import { LibraryCover } from "./LibraryCover";
import { LibraryStreamsSection } from "./LibraryStreamsSection";
import { LibraryLicensingSection } from "./LibraryLicensingSection";
import { EntityBadge } from "./LibraryTable";
import { fetchLibraryTrackDetail, type LibraryDetailResult, type LibrarySaveResult } from "./library.actions";

const noopSubscribe = () => () => {};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-0.5 text-xs">
      <dt style={{ color: "var(--sb-muted)" }}>{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

function Value({ v, mono }: { v: string | null; mono?: boolean }) {
  if (!v || !v.trim()) {
    return (
      <span className="opacity-40" style={{ color: "var(--sb-muted)" }}>
        —
      </span>
    );
  }
  return <span className={mono ? "font-mono text-[11px]" : ""}>{v}</span>;
}

function DetailsView({ row, entityName }: { row: LibraryRow; entityName: string }) {
  return (
    <dl className="space-y-1">
      <DetailRow label="Entity">
        <Value v={entityName} />
      </DetailRow>
      <DetailRow label="Artist">
        <Value v={row.sheet_artist} />
      </DetailRow>
      <DetailRow label="Title">
        <Value v={row.sheet_title} />
      </DetailRow>
      <DetailRow label="Release date">
        <Value v={row.release_date ? formatReleaseDate(row.release_date) : null} />
      </DetailRow>
      <DetailRow label="Distributor">
        <Value v={row.distributor_account} />
      </DetailRow>
      <DetailRow label="Label / Genre">
        <Value v={row.label_genre} />
      </DetailRow>
      <DetailRow label="Originality">
        <Value v={row.originality} />
      </DetailRow>
      <DetailRow label="Exclusivity">
        <Value v={row.exclusivity} />
      </DetailRow>
      <DetailRow label="Cover original artist">
        <Value v={row.cover_original_artist} />
      </DetailRow>
      <DetailRow label="Genre">
        <Value v={row.genre} />
      </DetailRow>
      <DetailRow label="New distro">
        <Value v={row.new_distro} />
      </DetailRow>
      <DetailRow label="Splice samples">{row.non_exclusive_samples ? "Yes" : "No"}</DetailRow>
      <DetailRow label="ISRC">
        <Value v={row.isrc} mono />
      </DetailRow>
      <DetailRow label="UPC">
        <Value v={row.upc} mono />
      </DetailRow>
      <DetailRow label="Length">
        <Value v={row.master_duration_s !== null ? formatDuration(row.master_duration_s) : null} />
      </DetailRow>
      <DetailRow label="Comment 1">
        <Value v={row.comment_1} />
      </DetailRow>
      <DetailRow label="Comment 2">
        <Value v={row.comment_2} />
      </DetailRow>
    </dl>
  );
}

export function LibraryDetailPanel({
  catalogId,
  row,
  entities,
  distributors,
  streamsAsOf,
  onClose,
  onSaved,
}: {
  catalogId: string;
  row: LibraryRow | null;
  entities: LibraryEntity[];
  distributors: string[];
  /** Date the stream figures are for, or null when streams didn't load. */
  streamsAsOf: string | null;
  onClose: () => void;
  /** Called with the saved row so the table updates straight away. */
  onSaved: (row: LibraryRow | null) => void;
}) {
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; result: LibraryDetailResult } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const hasRow = row !== null;
  const detailResult = loaded?.id === catalogId ? loaded.result : null;

  // Files, extra codes and history are loaded on demand, only for the open track.
  useEffect(() => {
    if (!hasRow) return;
    let cancelled = false;
    fetchLibraryTrackDetail(catalogId)
      .then((result) => {
        if (!cancelled) setLoaded({ id: catalogId, result });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoaded({ id: catalogId, result: { ok: false, error: error instanceof Error ? error.message : "Couldn't load details" } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [catalogId, hasRow, reloadKey]);

  useEffect(() => {
    if (!mounted) return;
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = prevOverflow;
    };
  }, [mounted]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Tab" && panelRef.current) {
        // Keep keyboard focus inside the open panel.
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key !== "Escape") return;
      if (editing) setEditing(false);
      else onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, onClose]);

  if (!mounted) return null;

  const entityName = row?.entity ? (entities.find((e) => e.code === row.entity)?.name ?? row.entity.toUpperCase()) : "";
  const dropbox = safeExternalUrl(row?.dropbox_link);
  const detail: LibraryTrackDetail | null = detailResult?.ok ? detailResult.detail : null;

  function handleSaved(result: Extract<LibrarySaveResult, { ok: true }>) {
    setEditing(false);
    refreshSavedDetails(result);
  }

  function refreshSavedDetails(result: Extract<LibrarySaveResult, { ok: true }>) {
    if (result.detail) setLoaded({ id: catalogId, result: { ok: true, detail: result.detail } });
    else setReloadKey((k) => k + 1);
    onSaved(result.row);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={row ? `${row.sheet_artist ?? ""} ${row.sheet_title ?? ""}`.trim() || catalogId : catalogId}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className="sb-glass relative flex h-full w-full flex-col overflow-hidden rounded-none shadow-2xl sm:max-w-[560px] sm:rounded-l-2xl animate-[modal-fade-in_180ms_ease-out]">
        <header className="flex flex-none items-start gap-3 px-4 pb-1 pt-3">
          {row ? <LibraryCover url={row.album_image_url} size={48} /> : null}
          <div className="min-w-0 flex-1 space-y-1">
            {row ? (
              <>
                <h2 className="font-display text-base font-semibold leading-snug tracking-tight">
                  {row.sheet_artist || "Unknown artist"} – {row.sheet_title || "Untitled"}
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--sb-muted)" }}>
                  <span className="font-mono text-[11px]">{row.catalog_id}</span>
                  <EntityBadge code={row.entity} name={entityName} />
                  <span>{formatReleaseDate(row.release_date)}</span>
                </div>
                {dropbox ? (
                  <Button asChild size="xs" variant="secondary" rightIcon={<ExternalLink className="h-3 w-3" />}>
                    <a href={dropbox} target="_blank" rel="noopener noreferrer">
                      Dropbox
                    </a>
                  </Button>
                ) : null}
              </>
            ) : (
              <h2 className="font-display text-base font-semibold tracking-tight">{catalogId}</h2>
            )}
          </div>
          <IconButton ref={closeRef} aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </header>

        <div className="flex-1 space-y-8 overflow-y-auto px-4 pb-6 pt-3">
          {!row ? (
            <Alert variant="warning" title="Release not found">
              {catalogId} isn&apos;t in the library.
            </Alert>
          ) : (
            <>
              <LibraryStreamsSection row={row} asOf={streamsAsOf} />

              <Section
                title="Details"
                aside={
                  editing ? null : (
                    <Button size="xs" variant="secondary" leftIcon={<Pencil className="h-3 w-3" />} onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  )
                }
              >
                {editing ? (
                  <LibraryEditForm
                    row={row}
                    entities={entities}
                    distributors={distributors}
                    onCancel={() => setEditing(false)}
                    onSaved={handleSaved}
                  />
                ) : (
                  <DetailsView row={row} entityName={entityName} />
                )}
              </Section>

              {detailResult && !detailResult.ok ? (
                <Alert
                  variant="error"
                  title="Couldn't load files and history"
                  actions={
                    <Button size="xs" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                      Retry
                    </Button>
                  }
                >
                  {detailResult.error}
                </Alert>
              ) : null}

              <CodesSection
                isrcs={detail?.isrcs ?? []}
                upcs={detail?.upcs ?? []}
                fallbackIsrc={row.isrc}
                fallbackUpc={row.upc}
              />

              {detail ? <LibraryLicensingSection batches={detail.licensing} onSaved={refreshSavedDetails} /> : !detailResult ? (
                <Section title="Licensing"><Skeleton className="h-16 w-full rounded-xl" /></Section>
              ) : null}

              {row.file_count > 0 ? (
                detail ? (
                  <FilesSection files={detail.files} sourceFolder={row.source_folder} />
                ) : detailResult ? null : (
                  <Section title="Files">
                    <Skeleton className="h-16 w-full rounded-xl" />
                  </Section>
                )
              ) : row.source_folder ? (
                <Section title="Drive folder">
                  <DriveFolder path={row.source_folder} />
                </Section>
              ) : null}

              {detail ? (
                <HistorySection history={detail.history} />
              ) : detailResult ? null : (
                <Section title="History">
                  <Skeleton className="h-16 w-full rounded-xl" />
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
