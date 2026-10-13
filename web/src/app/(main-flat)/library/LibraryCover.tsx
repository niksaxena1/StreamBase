"use client";

import { Music } from "lucide-react";
import { useState } from "react";

import { safeExternalUrl } from "@/lib/library/format";

/** Fixed-size cover thumbnail with a placeholder for missing or broken images. */
export function LibraryCover({ url, size = 32 }: { url: string | null | undefined; size?: number }) {
  const src = safeExternalUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  const style = { width: size, height: size };
  if (!src || failed === src) {
    return (
      <span
        className="flex flex-none items-center justify-center rounded-md"
        style={{ ...style, background: "var(--sb-accent-10)", color: "var(--sb-muted)" }}
        aria-hidden="true"
      >
        <Music style={{ width: size * 0.45, height: size * 0.45 }} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small fixed-size thumbnail from the stream data
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className="flex-none rounded-md object-cover"
      style={style}
      onError={() => setFailed(src)}
    />
  );
}
