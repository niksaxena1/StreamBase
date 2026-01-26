import { ReactNode } from "react";
import { Sparkline } from "@/components/charts/Sparkline";

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
            <Sparkline trend={props.trend || "neutral"} data={props.trendData} />
          </div>
        </div>
      </div>
    </div>
  );
}
