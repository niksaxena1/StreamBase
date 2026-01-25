import { ReactNode } from "react";

export function StatCard(props: {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  accent?: boolean;
  trend?: "up" | "down" | "neutral";
  trendData?: number[]; // Array of numbers for dynamic sparkline
}) {
  const className = [
    "relative overflow-hidden sb-card p-3 transition-shadow duration-200 hover:shadow-md",
    props.accent ? "ring-1 ring-lime-400/40" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
    >
      {/* Border Gradient via pseudo-element or inner div if needed, but ring is simpler for now. 
          Let's try a subtle gradient border effect using a background wrapper if requested, 
          but the user asked for "Border gradient".
      */}
      {props.accent && (
        <div className="absolute inset-0 pointer-events-none rounded-[var(--sb-radius)] ring-1 ring-inset ring-lime-500/20" />
      )}

      {props.accent ? (
        <div
          className="pointer-events-none absolute -right-10 -top-8 h-28 w-28 rounded-full opacity-50 blur-2xl"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(199,243,60,.6), rgba(199,243,60,0) 70%)",
          }}
        />
      ) : null}

      <div className="relative z-10 flex h-full flex-col justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide opacity-60">
            {props.title}
          </div>
          <div className="mt-1 font-display text-2xl font-bold tracking-tight leading-none">
            {props.value}
          </div>
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
            <Sparkline 
              trend={props.trend || "neutral"} 
              data={props.trendData}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ trend, data }: { trend: "up" | "down" | "neutral"; data?: number[] }) {
  // If we have real data, use it
  if (data && data.length >= 2) {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 80;
    const height = 30;
    const padding = 2;

    // Create SVG path from data
    const points = data.map((val, i) => {
      const x = padding + ((i / (data.length - 1)) * (width - padding * 2));
      const y = padding + ((1 - (val - min) / range) * (height - padding * 2));
      return `${x},${y}`;
    });

    const pathD = `M ${points.join(" L ")}`;
    const areaPath = `${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`;

    // Determine color based on trend direction
    const first = data[0];
    const last = data[data.length - 1];
    const isUp = last > first;
    const color = isUp ? "#c7f33c" : trend === "down" ? "#ff4d4d" : "currentColor";

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
        {isUp && (
          <path
            d={areaPath}
            fill="url(#gradient-up)"
            stroke="none"
            opacity="0.2"
          />
        )}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <defs>
          <linearGradient id="gradient-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c7f33c" />
            <stop offset="100%" stopColor="#c7f33c" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    );
  }

  // Fallback to static mock data paths
  const paths = {
    up: "M0 25 C10 25 10 20 20 20 C30 20 30 15 40 15 C50 15 50 5 60 5 C70 5 70 0 80 0",
    down: "M0 5 C10 5 10 10 20 10 C30 10 30 15 40 15 C50 15 50 20 60 20 C70 20 70 25 80 25",
    neutral: "M0 15 C20 15 20 10 40 15 C60 20 60 10 80 15",
  };

  const color = trend === "up" ? "#c7f33c" : trend === "down" ? "#ff4d4d" : "currentColor";

  return (
    <svg width="100%" height="100%" viewBox="0 0 80 30" preserveAspectRatio="none" className="overflow-visible">
      <path
        d={paths[trend]}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {trend === "up" && (
        <path
          d={`${paths[trend]} L 80 30 L 0 30 Z`}
          fill="url(#gradient-up)"
          stroke="none"
          opacity="0.2"
        />
      )}
      <defs>
        <linearGradient id="gradient-up" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c7f33c" />
          <stop offset="100%" stopColor="#c7f33c" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
