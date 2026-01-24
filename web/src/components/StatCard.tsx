import { ReactNode } from "react";

export function StatCard(props: {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  accent?: boolean;
  trend?: "up" | "down" | "neutral";
}) {
  const className = [
    "relative overflow-hidden rounded-[28px] sb-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg",
    props.accent ? "ring-1 ring-lime-400/50" : "",
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
        <div className="absolute inset-0 pointer-events-none rounded-[28px] ring-1 ring-inset ring-lime-500/20" />
      )}

      {props.accent ? (
        <div
          className="pointer-events-none absolute -right-12 -top-10 h-40 w-40 rounded-full opacity-70 blur-2xl"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(199,243,60,.6), rgba(199,243,60,0) 70%)",
          }}
        />
      ) : null}

      <div className="relative z-10 flex flex-col h-full justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider opacity-60">
            {props.title}
          </div>
          <div className="mt-2 font-display text-[32px] font-semibold tracking-tight leading-none">
            {props.value}
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between">
          {props.subtitle ? (
            <div className="text-xs opacity-60">
              {props.subtitle}
            </div>
          ) : <div />}

          {/* Sparkline Visual */}
          <div className="h-8 w-24 opacity-50">
             <Sparkline trend={props.trend || "neutral"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkline({ trend }: { trend: "up" | "down" | "neutral" }) {
  // Simple mock data paths
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
