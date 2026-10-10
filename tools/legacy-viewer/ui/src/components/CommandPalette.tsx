import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useUrlState } from "../app/useUrlState";
import { getJSON } from "../lib/api";
import { readLast, readRecent } from "../lib/lookup";
import {
  extractSpotifyId,
  rankPalette,
  type PaletteArtist,
  type PaletteItem,
  type PaletteTrack,
} from "../lib/palette";
import { Artwork } from "./ui";

type Candidates = { tracks: PaletteTrack[]; artists: PaletteArtist[] };

/**
 * Quick jump (Ctrl+K / Cmd+K): search tracks (title, artist, ISRC, Spotify ID/link) and artists,
 * accent/case-insensitive, prefix matches first. Enter on a track opens it in Track lookup keeping the
 * last From/To; Enter on an artist opens Track lookup with that artist chosen. Keyboard only works.
 */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useUrlState();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [candidates, setCandidates] = useState<Candidates>({
    tracks: [],
    artists: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dataset = state.dataset === "stats" ? "stats" : "stats2";
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setQuery("");
      setActive(0);
      setCandidates({ tracks: [], artists: [] });
      setError("");
      element.showModal();
      input.current?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);
  const needle = useMemo(() => {
    const id = extractSpotifyId(query);
    return id && (/\d/.test(id) || /spotify/i.test(query)) ? id : query.trim();
  }, [query]);
  useEffect(() => {
    if (!open || !needle) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      getJSON<Candidates>(
        "/api/lookup/search",
        { dataset, q: needle },
        controller.signal,
      )
        .then((data) => {
          if (controller.signal.aborted) return;
          setCandidates(data);
          setActive(0);
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : "Search failed");
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle, dataset, open]);
  const items = useMemo<PaletteItem[]>(() => {
    if (!query.trim())
      return readRecent()
        .filter((r) => r.dataset === dataset)
        .slice(0, 6)
        .map((r) => ({
          kind: "track" as const,
          key: `t:${r.isrc}`,
          tier: 0,
          track: { isrc: r.isrc, song_name: r.song_name, artist: r.artist },
        }));
    return rankPalette(needle, candidates.tracks, candidates.artists);
    // `open` re-reads recents each time the palette is shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, needle, candidates, dataset, open]);
  useEffect(() => {
    dialog.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const go = (item: PaletteItem) => {
    // Keep the From/To the user is working with: the current lookup's, otherwise the remembered one.
    const last = readLast();
    const kept =
      state.from && state.to
        ? { from: state.from, to: state.to }
        : last
          ? { from: last.from, to: last.to }
          : { from: "", to: "" };
    onClose();
    if (item.kind === "track")
      setState({
        page: "lookup",
        dataset,
        grain: "daily",
        params: { isrc: item.track.isrc },
        ...kept,
      });
    else
      setState({
        page: "lookup",
        dataset,
        grain: "daily",
        params: { artist: item.artist.name },
        ...kept,
      });
  };
  const sections: { title: string; entries: [PaletteItem, number][] }[] = [];
  items.forEach((item, index) => {
    const title = !query.trim()
      ? "Recent tracks"
      : item.kind === "track"
        ? "Tracks"
        : "Artists";
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.entries.push([item, index]);
    else sections.push({ title, entries: [[item, index]] });
  });
  return (
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Quick jump"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette-box">
        <input
          ref={input}
          className="palette-input"
          role="combobox"
          aria-label="Search tracks and artists"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          placeholder="Jump to a track or artist: title, artist, ISRC or Spotify link"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    items.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            } else if (event.key === "Home" || event.key === "End") {
              if (items.length) {
                event.preventDefault();
                setActive(event.key === "Home" ? 0 : items.length - 1);
              }
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (items[active]) go(items[active]);
            }
          }}
        />
        <div
          id={listId}
          className="palette-list"
          role="listbox"
          aria-label="Results"
          aria-busy={busy}
        >
          {error ? (
            <p role="alert" className="palette-note">
              {error}
            </p>
          ) : !items.length ? (
            <p role="status" className="palette-note">
              {!query.trim()
                ? "Type to search. Recent tracks appear here."
                : busy
                  ? "Searching…"
                  : "No tracks or artists match."}
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title} role="group" aria-label={section.title}>
                <div className="palette-heading" aria-hidden="true">
                  {section.title}
                </div>
                {section.entries.map(([item, index]) => (
                  <div
                    key={item.key}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === active}
                    className={`palette-row${index === active ? " active" : ""}`}
                    onPointerMove={() => setActive(index)}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      go(item);
                    }}
                  >
                    {item.kind === "track" ? (
                      <>
                        <Artwork
                          src={item.track.art}
                          name={item.track.song_name}
                          size={32}
                          inline
                          preview={false}
                        />
                        <span className="palette-text">
                          <span className="palette-primary">{item.track.song_name}</span>
                          <span className="palette-secondary">{item.track.artist}</span>
                        </span>
                        <code className="palette-trailing">{item.track.isrc}</code>
                      </>
                    ) : (
                      <>
                        <Artwork
                          src={item.artist.art}
                          name={item.artist.name}
                          shape="round"
                          size={32}
                          inline
                          preview={false}
                        />
                        <span className="palette-text">
                          <span className="palette-primary">{item.artist.name}</span>
                          <span className="palette-secondary">Artist</span>
                        </span>
                        <span className="palette-trailing">
                          {item.artist.track_count}{" "}
                          {item.artist.track_count === 1 ? "track" : "tracks"}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="palette-foot" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
          <span className="palette-dataset">
            {dataset === "stats" ? "stats server" : "stats2 complete"}
          </span>
        </div>
      </div>
    </dialog>
  );
}
