"use client";

import type { ThemeColors } from "@/components/charts/useThemeColors";
import { Modal } from "@/components/ui/Modal";
import { MAX_SEL_URL, NETWORK_LONG_PRESS_MS } from "./networkGraphConstants";

/** Help panel: keyboard shortcuts, gestures, toolbar filters, toggles, export and shareable URL params. */
export function NetworkHelpModal({
  open,
  onClose,
  colors,
}: {
  open: boolean;
  onClose: () => void;
  colors: ThemeColors;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Help"
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-4 text-sm" style={{ color: "var(--sb-text)" }}>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
            Keyboard
          </h3>
          <ul className="list-none space-y-2">
            <li>
              <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>/</kbd>{" "}
              <span style={{ color: "var(--sb-muted)" }}>Focus search</span>
            </li>
            <li>
              <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>?</kbd>{" "}
              <span style={{ color: "var(--sb-muted)" }}>Open or close this panel</span>
            </li>
            <li>
              <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>Esc</kbd>{" "}
              <span style={{ color: "var(--sb-muted)" }}>
                Close modals, then clear a pinned collaboration tooltip, then box selection, then focused artist
              </span>
            </li>
            <li>
              <kbd className="rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ borderColor: "var(--sb-border)" }}>F</kbd>{" "}
              <span style={{ color: "var(--sb-muted)" }}>Fit graph to view</span>
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
            Graph & selection
          </h3>
          <ul className="list-none space-y-2" style={{ color: "var(--sb-muted)" }}>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Box select:</span> Alt+drag on desktop, or turn on{" "}
              <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Select region</span> then drag.
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Distro tracks:</span> Ctrl/Cmd+click an artist node on desktop. Touch /
              pen: press and hold ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s on a node (keep still; same timing as charts).
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Collaboration edges:</span> hover for shared tracks. Click an edge
              (desktop) or press and hold ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s (touch / pen) to pin a rich tooltip
              (artist avatars, track list). In the pinned tooltip: click a track for stream/revenue details and distro
              playlists; Ctrl/⌘+click or long-press an artist for distro tracks (same as a node). Dismiss: canvas background,
              click the same edge again, or Esc.
            </li>
            <li>
              Touch / pen on empty canvas: hold still ~{(NETWORK_LONG_PRESS_MS / 1000).toFixed(2)}s, then drag a box. Dragging
              without holding pans the graph. <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Select region</span>{" "}
              starts a marquee immediately.
            </li>
            <li>
              A faint grid moves with the graph. Zooming in can show finer dashed lines; x=0 and y=0 are slightly bolder when
              visible.
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
            Toolbar filters
          </h3>
          <ul className="list-none space-y-2" style={{ color: "var(--sb-muted)" }}>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Graph scope</span> (dropdown): all catalog, one playlist, or{" "}
              <span style={{ color: "var(--sb-text)" }}>Custom playlist scope…</span> (modal: Any of / All of / Not in
              selected playlists). Custom scopes use URL params{" "}
              <code className="font-mono text-[11px]">net_scope=custom</code>,{" "}
              <code className="font-mono text-[11px]">net_pl</code>,{" "}
              <code className="font-mono text-[11px]">net_pl_m</code>.
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Co-artists</span>: min / max 0–999 (either or both; blank = open bound),
              blur or Enter to apply. <span style={{ color: "var(--sb-text)" }}>Playlist</span> vs{" "}
              <span style={{ color: "var(--sb-text)" }}>Lead only</span> changes what we count as a co-artist.
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Node tracks</span> filters by each node&apos;s in-scope{" "}
              <code className="font-mono text-[11px]">track_count</code> (min / max).
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
            Toggles
          </h3>
          <ul className="list-none space-y-2" style={{ color: "var(--sb-muted)" }}>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Scale by tracks</span> — node size from catalog track count.
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Show images</span> — avatars on nodes when available.
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Hide non-primary</span> — drop artists with no lead track in scope.
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Table</span> — sortable list of visible artists (avatars, sticky
              header, row activates the graph, in-scope totals from the same API as the Excel Artists sheet). Values follow the
              global metric (Streams / Revenue / Tracks→Streams) and payout rate like catalog tables. Sort order is stored in the
              URL (
              <code className="font-mono text-[11px]">tbl_sort</code>,{" "}
              <code className="font-mono text-[11px]">tbl_dir</code>).
            </li>
            <li>
              <span style={{ color: "var(--sb-text)" }}>Funnel</span> — advanced filters: AND/OR inside each group, and when
              you add multiple groups, <span style={{ color: "var(--sb-text)", fontWeight: 600 }}>Combine groups</span> chooses
              AND vs OR between them. Save/load presets in the modal (this device).
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: colors.accent }}>
            Export & link
          </h3>
          <p className="text-[13px] leading-snug" style={{ color: "var(--sb-muted)" }}>
            Download builds a multi-sheet <code className="font-mono text-[11px]">.xlsx</code> (Summary, Artists,
            Collaborations, Tracks, Tracks unique) for the current scope and toolbar filters.
          </p>
          <p className="text-[13px] leading-snug mt-2" style={{ color: "var(--sb-muted)" }}>
            Copy the address bar URL to share the view. Anyone signed in as an{" "}
            <span style={{ color: "var(--sb-text)" }}>admin</span> can open it and get the same scope, toolbar filters, table
            on/off, table sort, and multi-select (<code className="font-mono text-[11px]">sel=</code>, up to {MAX_SEL_URL}{" "}
            ids).
          </p>
          <p className="text-[13px] leading-snug mt-2" style={{ color: "var(--sb-muted)" }}>
            The URL encodes scope (<code className="font-mono text-[11px]">playlist=…</code> or custom{" "}
            <code className="font-mono text-[11px]">net_scope</code> / <code className="font-mono text-[11px]">net_pl</code> /{" "}
            <code className="font-mono text-[11px]">net_pl_m</code>), toggles,{" "}
            <code className="font-mono text-[11px]">collab_min</code> /{" "}
            <code className="font-mono text-[11px]">collab_max</code> (inclusive range; either or both),{" "}
            <code className="font-mono text-[11px]">co_basis=primary</code>,{" "}
            <code className="font-mono text-[11px]">tc_min</code> / <code className="font-mono text-[11px]">tc_max</code>,{" "}
            <code className="font-mono text-[11px]">table=1</code>,{" "}
            <code className="font-mono text-[11px]">tbl_sort</code> / <code className="font-mono text-[11px]">tbl_dir</code>{" "}
            (including <code className="font-mono text-[11px]">streams_total</code> /{" "}
            <code className="font-mono text-[11px]">streams_daily</code>).
          </p>
          <p className="text-[13px] leading-snug mt-2" style={{ color: "var(--sb-muted)" }}>
            The advanced filter (<span style={{ color: "var(--sb-text)" }}>Funnel</span>) is not stored in the URL — presets
            stay on this device; pan/zoom is saved in local storage per graph identity. Re-apply the funnel or align the camera
            after opening a shared link.
          </p>
        </section>
      </div>
    </Modal>
  );
}
