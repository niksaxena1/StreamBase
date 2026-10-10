import { useEffect, useMemo, useState } from "react";
import type { DayRanges } from "../lib/calendar";
import { monthLabel } from "../lib/format";
import {
  clampRange,
  monthRange,
  presetRange,
  type Preset,
  type Range,
} from "../lib/lookup";
import { DayPicker } from "./ui/DayPicker";
import { Button, Select } from "./ui";

export const PRESETS: Preset[] = [
  "Last 7 days",
  "Last 30 days",
  "Previous month",
  "Whole history",
];

/**
 * From / To calendars, presets and the month chooser, shared by Track lookup and the Artist report.
 * `bounds` are the first/last tracked UTC days (a track's, or the dataset's); `ranges` (optional) are
 * the days with a reading, so the calendar can show gaps. Typed dates are validated like the calendar.
 */
export function RangeControls({
  range,
  bounds,
  ranges,
  months,
  onRange,
  presetTitle = "Ends at the last archived reading",
}: {
  range: Range;
  bounds: Range;
  ranges?: DayRanges;
  /** YYYY-MM values offered by the month chooser, newest first. */
  months: string[];
  onRange: (range: Range) => void;
  presetTitle?: string;
}) {
  const [draft, setDraft] = useState(range);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(range);
    setError("");
  }, [range]);
  const edit = (side: "from" | "to", value: string) => {
    const next = { ...draft, [side]: value };
    setDraft(next);
    if (value < bounds.from || value > bounds.to || next.from > next.to) {
      setError(
        "Choose From on or before To, within the first and last tracked dates.",
      );
      return;
    }
    setError("");
    onRange(next);
  };
  const monthValue = useMemo(
    () =>
      range.from.slice(0, 7) === range.to.slice(0, 7)
        ? range.from.slice(0, 7)
        : "",
    [range],
  );
  return (
    <>
      <div className="lookup-date-row">
        <div className="lookup-date-field">
          <span className="lookup-date-label">From</span>
          <DayPicker
            label="From"
            value={draft.from}
            bounds={bounds}
            ranges={ranges}
            selection={range}
            invalid={!!error}
            onChange={(day) => edit("from", day)}
          />
        </div>
        <div className="lookup-date-field">
          <span className="lookup-date-label">To</span>
          <DayPicker
            label="To"
            value={draft.to}
            bounds={bounds}
            ranges={ranges}
            selection={range}
            invalid={!!error}
            onChange={(day) => edit("to", day)}
          />
        </div>
        <div className="lookup-presets row">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              title={presetTitle}
              onClick={() => onRange(presetRange(preset, bounds))}
            >
              {preset}
            </Button>
          ))}
          <Select
            aria-label="Choose month"
            value={monthValue}
            onChange={(event) => {
              if (event.target.value)
                onRange(clampRange(monthRange(event.target.value), bounds));
            }}
          >
            <option value="">Choose month…</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error && (
        <p role="alert" className="small negative">
          {error}
        </p>
      )}
    </>
  );
}
