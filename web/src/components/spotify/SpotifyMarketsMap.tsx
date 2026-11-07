"use client";

import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import worldData from "world-atlas/countries-110m.json";

import { iso2FromNumeric } from "@/lib/health/isoNumeric";
import { marketName } from "@/lib/health/spotifyMarketFormat";

const WIDTH = 960;
const HEIGHT = 480;

type Shape = { code: string | null; name: string; d: string };

/** Country outlines, computed once per page load (the 110m atlas is bundled locally, no runtime fetch). */
const SHAPES: Shape[] = (() => {
  const topo = worldData as unknown as Topology;
  const countries = feature(topo, topo.objects.countries as GeometryCollection);
  const projection = geoNaturalEarth1().fitExtent(
    [
      [2, 2],
      [WIDTH - 2, HEIGHT - 2],
    ],
    { type: "Sphere" },
  );
  const toPath = geoPath(projection);
  const out: Shape[] = [];
  for (const f of countries.features) {
    if (String(f.id) === "010") continue; // Antarctica: not a Spotify market, saves vertical space
    const d = toPath(f);
    if (!d) continue;
    out.push({ code: iso2FromNumeric(f.id), name: String((f.properties as { name?: string } | null)?.name ?? ""), d });
  }
  return out;
})();

const DRAWN_CODES: ReadonlySet<string> = new Set(SHAPES.flatMap((s) => (s.code ? [s.code] : [])));

/**
 * World map for the Catalog territory modal: territories where the track is missing in red, everything
 * else muted green. Plain SVG (d3-geo + topojson-client + world-atlas); loaded lazily by the modal.
 */
export function SpotifyMarketsMap({ missing }: { missing: string[] }) {
  const missingSet = useMemo(() => new Set(missing), [missing]);
  const [hover, setHover] = useState<Shape | null>(null);
  // The 110m atlas leaves out small territories (Singapore, Malta, ...); list them instead of hiding them.
  const undrawn = useMemo(() => missing.filter((c) => !DRAWN_CODES.has(c)).sort(), [missing]);
  const hoverCode = hover?.code ?? null;
  const hoverMissing = hoverCode != null && missingSet.has(hoverCode);

  return (
    <div>
      <div className="mb-1 flex min-h-[18px] flex-wrap items-center justify-between gap-2 text-xs">
        <span style={{ color: "var(--sb-text)" }}>
          {hover ? (
            <>
              <span className="font-medium">{hoverCode ? marketName(hoverCode) : hover.name}</span>
              <span style={{ color: "var(--sb-muted)" }}>
                {" "}
                · {hoverCode == null ? "not checked" : hoverMissing ? "not available" : "available"}
              </span>
            </>
          ) : (
            <span style={{ color: "var(--sb-muted)" }}>Hover a country</span>
          )}
        </span>
        <span className="flex items-center gap-3" style={{ color: "var(--sb-muted)" }}>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-500/80" /> Not available
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/35" /> Available
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`World map: not available in ${missing.length} ${missing.length === 1 ? "territory" : "territories"}`}
        className="h-[220px] w-full rounded-lg border border-[color:var(--sb-border)]"
        onMouseLeave={() => setHover(null)}
      >
        {SHAPES.map((s, i) => {
          const isMissing = s.code != null && missingSet.has(s.code);
          return (
            <path
              key={`${s.code ?? "x"}-${i}`}
              d={s.d}
              className={
                isMissing
                  ? "fill-red-500/80 stroke-white/70 hover:fill-red-600 dark:stroke-black/40"
                  : s.code
                    ? "fill-emerald-500/35 stroke-white/70 hover:fill-emerald-500/55 dark:stroke-black/40"
                    : "fill-black/10 stroke-white/70 dark:fill-white/10 dark:stroke-black/40"
              }
              strokeWidth={0.6}
              onMouseEnter={() => setHover(s)}
            >
              <title>
                {s.code ? `${marketName(s.code)}: ${isMissing ? "not available" : "available"}` : s.name}
              </title>
            </path>
          );
        })}
      </svg>
      {undrawn.length > 0 ? (
        <p className="mt-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
          Too small to draw: {undrawn.map((c) => `${marketName(c)} (${c})`).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
