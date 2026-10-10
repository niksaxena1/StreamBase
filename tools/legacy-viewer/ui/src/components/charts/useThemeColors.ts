import { useEffect, useRef, useState } from "react";
export function useThemeColors() {
  const [revision, setRevision] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setRevision((revision) => revision + 1),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    setRevision((revision) => revision + 1);
    return () => observer.disconnect();
  }, []);
  // Read the local scope as well, so gallery themes can coexist on one page.
  const style = getComputedStyle(ref.current ?? document.documentElement);
  const get = (token: string) => style.getPropertyValue(`--sb-${token}`).trim();
  void revision;
  return {
    ref,
    colors: {
      accent: get("accent-stroke"),
      positive: get("positive"),
      tracks: get("tracks"),
      revenue: get("revenue"),
      warning: get("warning"),
      error: get("error"),
      info: get("info"),
      text: get("text"),
      muted: `color-mix(in srgb, ${get("text")} 70%, ${get("bg")})`,
      border: get("border"),
      card: get("card"),
      bg: get("bg"),
    },
  };
}
