import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { initials, PREVIEW_MAX, tileTone } from "../../lib/art";

type Preview = { src: string; name: string; shape: "round" | "square" };
const PreviewContext = createContext<(preview: Preview) => void>(() => {});

/** Enlarged artwork modal (StreamBase pattern): dim + blur backdrop, Esc / click to close. */
export function ArtworkPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setPreview(null);
    opener.current?.focus?.();
  }, []);
  const open = useCallback((next: Preview) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPreview(next);
  }, []);
  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [preview, close]);
  return (
    <PreviewContext.Provider value={open}>
      {children}
      {preview &&
        createPortal(
          <div
            className="artwork-preview"
            role="dialog"
            aria-modal="true"
            aria-label={`Artwork: ${preview.name}`}
            data-testid="artwork-preview"
            onMouseDown={close}
          >
            <div
              className="artwork-preview-card"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <img
                src={preview.src}
                alt={preview.name}
                className={`artwork-preview-image ${preview.shape}`}
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
              />
              <p>{preview.name}</p>
              <button
                type="button"
                className="button button-secondary"
                autoFocus
                onClick={close}
              >
                Close
              </button>
            </div>
          </div>,
          document.body,
        )}
    </PreviewContext.Provider>
  );
}

/**
 * Cover (square, 4px radius) or artist photo (round). Missing artwork becomes a tasteful
 * initials tile. Clicking real artwork enlarges it; `inline` is for use inside other
 * interactive rows (pickers, table rows) and never triggers the parent's action.
 */
export function Artwork({
  src,
  name,
  shape = "square",
  size = 32,
  preview = true,
  inline = false,
  className = "",
}: {
  src?: string | null;
  name: string;
  shape?: "round" | "square";
  size?: number;
  preview?: boolean;
  inline?: boolean;
  className?: string;
}) {
  const open = useContext(PreviewContext);
  const [failed, setFailed] = useState<string | null>(null);
  const live = !!src && failed !== src;
  const style = useMemo(
    () => ({ "--art-size": `${size}px` }) as CSSProperties,
    [size],
  );
  const classes = `artwork artwork-${shape} ${className}`;
  if (!live) {
    return (
      <span
        className={`${classes} artwork-tile tone-${tileTone(name)}`}
        style={style}
        aria-hidden="true"
        data-initials={initials(name)}
      >
        <span style={{ fontSize: Math.max(9, Math.round(size * 0.36)) }}>
          {initials(name)}
        </span>
      </span>
    );
  }
  const image = (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(src)}
    />
  );
  if (!preview)
    return (
      <span className={classes} style={style}>
        {image}
      </span>
    );
  const activate = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    open({ src, name, shape });
  };
  return (
    <button
      type="button"
      className={`${classes} artwork-button`}
      style={style}
      aria-label={`View artwork for ${name}`}
      tabIndex={inline ? -1 : 0}
      onClick={activate}
      // Keep focus and the parent's pointer handlers (e.g. option selection) out of the way.
      onPointerDown={inline ? (event) => { event.preventDefault(); event.stopPropagation(); } : undefined}
      onMouseDown={inline ? (event) => event.stopPropagation() : undefined}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {image}
    </button>
  );
}
