import { useState } from "react";
import { DAY_MS, dateKey, formatUtcDate, utcDate } from "../../lib/format";
import { Button, Modal, Select } from "./index";
import type { Grain } from "../../app/useUrlState";
export type DateRange = { from: string; to: string };
export type DateBounds = DateRange;
export function archivePresets(
  bounds: DateBounds,
): { label: string; range: DateRange }[] {
  if (!bounds.from || !bounds.to || bounds.from > bounds.to) return [];
  const result = [{ label: "All archive", range: bounds }];
  for (
    let year = utcDate(bounds.from).getUTCFullYear();
    year <= utcDate(bounds.to).getUTCFullYear();
    year++
  ) {
    result.push({
      label: String(year),
      range: {
        from: bounds.from > `${year}-01-01` ? bounds.from : `${year}-01-01`,
        to: bounds.to < `${year}-12-31` ? bounds.to : `${year}-12-31`,
      },
    });
  }
  for (const days of [30, 90, 365]) {
    const start = dateKey(
      new Date(
        utcDate(bounds.to).getTime() - (days - 1) * DAY_MS,
      ).toISOString(),
    );
    result.push({
      label: `Last ${days} days of archive`,
      range: { from: start < bounds.from ? bounds.from : start, to: bounds.to },
    });
  }
  return result;
}
export function DateRangePicker({
  value,
  bounds,
  onChange,
  disabled = false,
}: {
  value: DateRange;
  bounds?: DateBounds;
  onChange: (range: DateRange) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(value);
  const valid =
    !!draft.from &&
    !!draft.to &&
    draft.from <= draft.to &&
    (!bounds || (draft.from >= bounds.from && draft.to <= bounds.to));
  return (
    <>
      <Button
        disabled={disabled}
        aria-label="Choose UTC date range"
        onClick={() => {
          setDraft(value.from ? value : (bounds ?? value));
          setOpen(true);
        }}
      >
        <span aria-hidden="true">▦</span>{" "}
        <span className={value.from && value.to ? "mono" : ""}>
          {value.from && value.to
            ? `${formatUtcDate(value.from)} – ${formatUtcDate(value.to)}`
            : "All archive"}
        </span>
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Archive date range"
      >
        <p className="muted">
          Dates are UTC calendar days. Presets end at the archive’s last
          observation.
        </p>
        <div className="range-presets">
          {bounds &&
            archivePresets(bounds).map((preset) => (
              <Button
                className="mono"
                key={preset.label}
                onClick={() => setDraft(preset.range)}
              >
                {preset.label}
              </Button>
            ))}
        </div>
        <div className="row">
          <label>
            From
            <input
              className="mono"
              type="date"
              value={draft.from}
              min={bounds?.from}
              max={draft.to || bounds?.to}
              onChange={(event) =>
                setDraft({ ...draft, from: event.target.value })
              }
            />
          </label>
          <label>
            To
            <input
              className="mono"
              type="date"
              value={draft.to}
              min={draft.from || bounds?.from}
              max={bounds?.to}
              onChange={(event) =>
                setDraft({ ...draft, to: event.target.value })
              }
            />
          </label>
        </div>
        {!valid && (
          <p role="status" className="small">
            Choose a valid range within the archive.
          </p>
        )}
        <div className="row end section-content">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="accent"
            disabled={!valid}
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply range
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function GranularitySelect({
  value,
  onChange,
}: {
  value: Grain;
  onChange: (value: Grain) => void;
}) {
  return (
    <Select
      aria-label="Granularity"
      value={value}
      onChange={(event) => onChange(event.target.value as Grain)}
    >
      {["daily", "weekly", "monthly"].map((grain) => (
        <option key={grain} value={grain}>
          {grain[0].toUpperCase() + grain.slice(1)}
        </option>
      ))}
    </Select>
  );
}
