import { memo, type CSSProperties, type ReactNode } from "react";
import { Sparkline } from "@/components/charts/Sparkline";

export const StatCard = memo(function StatCard(props: {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  accent?: boolean;
  trend?: "up" | "down" | "neutral";
  trendData?: number[]; // Array of numbers for dynamic sparkline
  accentColor?: string; // Custom accent color (ring and glow)
  distroName?: string | null;
  distroImageUrl?: string | null;
}) {
  // Use custom accent color if provided, otherwise lime green (default)
  const accentColor = props.accentColor ?? "#c7f33c";

  // Convert hex to rgba for opacity variations
  const getRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const className = [
    "relative overflow-hidden sb-card p-3 transition-shadow duration-200 hover:shadow-md",
    props.accent
      ? [
          // Stronger selection affordance (visible in light + dark mode)
          // Note: avoid Tailwind `ring-*` + arbitrary `shadow-[...]` because both use box-shadow
          // and the arbitrary shadow overrides the ring entirely. We instead apply a strong
          // selection outline via inline box-shadow below.
        ].join(" ")
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const accentStyle: CSSProperties | undefined = props.accent
    ? ({
        // Remove the base sb-card border so we don't get a 2nd outline (and avoid a 1px "gap").
        borderWidth: 0,
        borderColor: "transparent",
        // Strong, clear selection stroke + glow (works in light/dark).
        boxShadow: [
          `0 0 0 1px ${getRgba(accentColor, 0.75)}`,
          `0 0 18px ${getRgba(accentColor, 0.20)}`,
          "var(--sb-shadow-compact)",
        ].join(", "),
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={className}
      style={accentStyle}
    >
      {/* Border Gradient via pseudo-element or inner div if needed, but ring is simpler for now. 
          Let's try a subtle gradient border effect using a background wrapper if requested, 
          but the user asked for "Border gradient".
      */}
      {props.accent && (
        <div
          className="absolute inset-0 pointer-events-none rounded-[var(--sb-radius)]"
          style={
            {
              boxShadow: `inset 0 0 0 1px ${getRgba(accentColor, 0.28)}`,
            } as CSSProperties
          }
        />
      )}

      {props.accent ? (
        <div
          className="pointer-events-none absolute -right-10 -top-8 h-28 w-28 rounded-full opacity-50 blur-2xl"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${getRgba(accentColor, 0.6)}, ${getRgba(accentColor, 0)} 70%)`,
          }}
        />
      ) : null}

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="text-[11px] font-medium uppercase tracking-wide opacity-60">
              {props.title}
            </div>
            <div className="mt-1 font-display text-2xl font-bold tracking-tight leading-none">
              {props.value}
            </div>
          </div>

          {/* Distro info in top-right */}
          {(props.distroName || props.distroImageUrl) && (
            <div className="flex items-center gap-1">
              {props.distroImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={props.distroImageUrl}
                  alt={props.distroName || "distro"}
                  className="h-5 w-5 rounded object-cover flex-shrink-0"
                />
              )}
              {props.distroName && (
                <span className="text-[10px] opacity-60 max-w-[80px] truncate">{props.distroName}</span>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-end justify-between gap-2">
          {props.subtitle ? (
            <div className="text-xs opacity-60">
              {props.subtitle}
            </div>
          ) : (
            <div />
          )}

          {/* Sparkline Visual */}
          <div className="h-6 w-20 opacity-50">
            <Sparkline trend={props.trend || "neutral"} data={props.trendData} color={accentColor} />
          </div>
        </div>
      </div>
    </div>
  );
});
