import type { ReactNode } from "react";

export function SilentSortHeader(props: {
  label: ReactNode;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`w-full cursor-default select-none uppercase ${props.align === "right" ? "text-right" : "text-left"}`}
      style={{ color: "inherit" }}
    >
      {typeof props.label === "string" ? props.label.toUpperCase() : props.label}
    </button>
  );
}
