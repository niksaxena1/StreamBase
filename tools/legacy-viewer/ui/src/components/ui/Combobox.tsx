import { useEffect, useId, useMemo, useRef, useState, type Ref } from "react";
import { rankOptions, type PickerOption } from "../../lib/pickers";
import { Artwork } from "./Artwork";

export type { PickerOption } from "../../lib/pickers";

function OptionRow({ option }: { option: PickerOption }) {
  return (
    <>
      {option.thumb && (
        <Artwork
          src={option.thumb.src}
          name={option.thumb.name}
          shape={option.thumb.shape}
          size={24}
          inline
        />
      )}
      <span className="option-text">
        <span className="option-primary">{option.primary ?? option.label}</span>
        {option.secondary && (
          <span className="option-secondary">{option.secondary}</span>
        )}
      </span>
      {option.trailing && (
        <span className="option-trailing mono">{option.trailing}</span>
      )}
    </>
  );
}

export function Combobox({
  label,
  value,
  options = [],
  search,
  onChange,
  disabled = false,
  ranking = "match",
  loading = false,
  inputRef,
}: {
  label: string;
  value: string | null;
  options?: readonly PickerOption[];
  search?: (query: string, signal: AbortSignal) => Promise<PickerOption[]>;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** match = filter local lists / prefix-first reorder remote ones; server = keep server order. */
  ranking?: "match" | "server";
  /** The option list is still being fetched (keeps the field focusable, unlike disabled). */
  loading?: boolean;
  /** Lets a page focus the field from a keyboard shortcut. */
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [remote, setRemote] = useState<PickerOption[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selection, setSelection] = useState<PickerOption | null>(null);
  const selected =
    options.find((option) => option.value === value) ??
    (selection?.value === value ? selection : null);
  // Local lists are ranked here; remote (API) results are re-ranked so prefix matches lead.
  const filtered = useMemo(
    () =>
      ranking === "server" && search
        ? remote
        : rankOptions(search ? remote : options, query, !search),
    [search, remote, options, query, ranking],
  );
  useEffect(() => {
    if (!open || !search) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setRemote([]);
    const timeout = setTimeout(() => {
      search(query, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setRemote(result);
            setActive(0);
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(
              reason instanceof Error ? reason.message : "Search failed",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 180);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, search, open]);
  useEffect(() => {
    root.current
      ?.querySelector(`#${CSS.escape(id)}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  function choose(option: PickerOption) {
    setSelection(option);
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }
  return (
    <div ref={root} className="combobox">
      {!open && selected?.thumb && (
        <span className="combobox-thumb" aria-hidden="true">
          <Artwork
            src={selected.thumb.src}
            name={selected.thumb.name}
            shape={selected.thumb.shape}
            size={24}
            preview={false}
          />
        </span>
      )}
      <input
        ref={inputRef}
        disabled={disabled}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={
          open && filtered[active] ? `${id}-${active}` : undefined
        }
        className={!open && selected?.thumb ? "has-thumb" : undefined}
        value={open ? query : (selected?.label ?? "")}
        placeholder={`Search ${label.toLowerCase()}`}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((index) =>
              Math.max(
                0,
                Math.min(
                  filtered.length - 1,
                  index + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (open && (event.key === "Home" || event.key === "End")) {
            event.preventDefault();
            setActive(
              event.key === "Home" ? 0 : Math.max(0, filtered.length - 1),
            );
          }
          if (open && event.key === "Enter") {
            event.preventDefault();
            if (!busy && filtered[active]) choose(filtered[active]);
          }
        }}
      />
      {open && (
        <div
          className="popover"
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          aria-busy={busy}
        >
          {busy || (loading && !filtered.length) ? (
            <div role="status">{loading && !busy ? "Loading…" : "Searching…"}</div>
          ) : error ? (
            <div role="alert">{error}</div>
          ) : !filtered.length ? (
            <div role="status">No results</div>
          ) : (
            filtered.map((option, i) => (
              <div
                key={option.value}
                id={`${id}-${i}`}
                role="option"
                aria-label={[
                  option.primary ?? option.label,
                  option.secondary,
                  option.trailingLabel ?? option.trailing,
                ]
                  .filter(Boolean)
                  .join(", ")}
                aria-selected={option.value === value}
                className={`${i === active ? "active" : ""} ${option.thumb || option.trailing || option.secondary ? "rich-option" : ""}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                <OptionRow option={option} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
