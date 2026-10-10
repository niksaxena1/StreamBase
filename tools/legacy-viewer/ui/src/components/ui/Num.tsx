import { displayNumber, displaySigned, exactTitle, fullNumber } from "../../lib/format";
import { useNumberMode } from "../../lib/numberMode";

/**
 * A count in the app-wide display mode (exact / compact). In compact mode the exact value is always
 * available on hover (title); screen readers get the exact value too.
 */
export function Num({
  value,
  digits = 0,
  signed = false,
  className,
}: {
  value: number | null | undefined;
  digits?: number;
  signed?: boolean;
  className?: string;
}) {
  const [mode] = useNumberMode();
  const text = signed ? displaySigned(value, mode) : displayNumber(value, digits, mode);
  const exact = signed
    ? typeof value === "number" && Number.isFinite(value) && mode === "compact"
      ? `${value >= 0 ? "+" : "−"}${fullNumber(Math.abs(value), digits)}`
      : undefined
    : exactTitle(value, digits, mode);
  return (
    <span className={className} title={exact}>
      {text}
    </span>
  );
}
