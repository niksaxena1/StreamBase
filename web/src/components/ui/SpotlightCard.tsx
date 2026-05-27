"use client";

import { MouseEvent } from "react";
import { motion, useMotionTemplate, useMotionValue } from "framer-motion";

export function SpotlightCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const background = useMotionTemplate`
    radial-gradient(
      650px circle at ${mouseX}px ${mouseY}px,
      color-mix(in srgb, var(--sb-accent) 15%, transparent),
      transparent 80%
    )
  `;

  function handleMouseMove({ currentTarget, clientX, clientY }: MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect();
    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  // Check if the className requests overflow-visible (for charts with tooltips)
  const hasOverflowVisible = className.includes("overflow-visible");
  const overflowClass = hasOverflowVisible ? "overflow-visible" : "overflow-hidden";

  return (
    <div
      className={["sb-card group relative border border-transparent bg-[var(--sb-card)] dark:bg-neutral-900", overflowClass, className].join(" ")}
      onMouseMove={handleMouseMove}
    >
      <motion.div
        className="pointer-events-none absolute -inset-px rounded-[var(--sb-radius)] opacity-0 transition duration-300 group-hover:opacity-100"
        style={{
          background,
        }}
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
