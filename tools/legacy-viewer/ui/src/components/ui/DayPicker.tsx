import { useEffect, useId, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  clampDay,
  dayStatus,
  monthGrid,
  parseTypedDate,
  type DayRanges,
} from "../../lib/calendar";
import { formatUtcDate } from "../../lib/format";

type Range = { from: string; to: string };
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const STATUS_TEXT = {
  reading: "has a reading",
  gap: "no reading (the previous reading is used)",
  outside: "outside the tracked dates",
} as const;

/**
 * UTC calendar popover with a typed-date field. `bounds` = first/last tracked day; `ranges` = days
 * that have a reading. Days with a reading, gap days (tracked span, no reading) and days outside
 * tracking look different; outside days cannot be chosen. Fully keyboard operable:
 * arrows move by day/week, Home/End jump to week start/end, PageUp/PageDown move a month
 * (Shift = year), Enter/Space choose, Esc closes.
 */
export function DayPicker({
  label,
  value,
  onChange,
  bounds,
  ranges,
  selection,
  invalid = false,
}: {
  label: string;
  value: string;
  /** Called with a valid, in-bounds day, chosen in the calendar or typed. */
  onChange: (day: string) => void;
  bounds: Range;
  ranges?: DayRanges;
  /** The currently compared range, lightly highlighted in the grid. */
  selection?: Range;
  invalid?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [focus, setFocus] = useState(() => clampDay(value, bounds));
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => {
    if (!open || !pending.current) return;
    pending.current = false;
    root.current
      ?.querySelector<HTMLButtonElement>(`button[data-day="${focus}"]`)
      ?.focus();
  }, [open, focus]);
  const openCalendar = () => {
    setFocus(clampDay(parseTypedDate(draft) ?? value, bounds));
    pending.current = true;
    setOpen(true);
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) input.current?.focus();
  };
  const move = (day: string) => {
    pending.current = true;
    setFocus(clampDay(day, bounds));
  };
  const choose = (day: string) => {
    if (dayStatus(day, bounds) === "outside") return;
    onChange(day);
    close(true);
  };
  const year = Number(focus.slice(0, 4)),
    month = Number(focus.slice(5, 7)) - 1;
  const years: number[] = [];
  for (let y = Number(bounds.from.slice(0, 4)); y <= Number(bounds.to.slice(0, 4)); y++)
    years.push(y);
  if (!years.includes(year)) years.push(year);
  const jump = (target: number, shift: number) =>
    move(addMonths(focus, target * 12 + shift));
  const weeks = monthGrid(year, month);
  const typedInvalid = draft !== "" && parseTypedDate(draft) === null;
  return (
    <div className="daypicker" ref={root}>
      <div className="daypicker-field">
        <input
          ref={input}
          className="daypicker-input"
          aria-label={`${label} date`}
          aria-invalid={invalid || typedInvalid || undefined}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const parsed = parseTypedDate(text);
            if (parsed) onChange(parsed);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || (event.key === "Enter" && !open)) {
              event.preventDefault();
              openCalendar();
            }
            if (event.key === "Escape" && open) {
              event.preventDefault();
              close(false);
            }
          }}
        />
        <button
          type="button"
          className="daypicker-toggle"
          aria-label={`Open ${label} calendar`}
          aria-expanded={open}
          aria-controls={open ? `${id}-dialog` : undefined}
          onClick={() => (open ? close(false) : openCalendar())}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2 6.5h12M5 1.8v2.6M11 1.8v2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div
          id={`${id}-dialog`}
          className="daypicker-popover"
          role="dialog"
          aria-label={`Choose ${label} date`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="daypicker-head">
            <button
              type="button"
              aria-label="Previous month"
              disabled={focus.slice(0, 7) <= bounds.from.slice(0, 7)}
              onClick={() => jump(0, -1)}
            >
              ‹
            </button>
            <select
              aria-label="Month"
              value={month}
              onChange={(event) => jump(0, Number(event.target.value) - month)}
            >
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Year"
              value={year}
              onChange={(event) => jump(Number(event.target.value) - year, 0)}
            >
              {years.sort().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Next month"
              disabled={focus.slice(0, 7) >= bounds.to.slice(0, 7)}
              onClick={() => jump(0, 1)}
            >
              ›
            </button>
          </div>
          <table role="grid" aria-label={`${MONTH_NAMES[month]} ${year}`}>
            <thead>
              <tr>
                {WEEKDAYS.map((name) => (
                  <th key={name} scope="col" abbr={name}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const status = dayStatus(day, bounds, ranges);
                    const inMonth = day.slice(0, 7) === focus.slice(0, 7);
                    const chosen = day === value;
                    const within =
                      !!selection && day >= selection.from && day <= selection.to;
                    return (
                      <td key={day} role="gridcell" aria-selected={chosen}>
                        <button
                          type="button"
                          data-day={day}
                          data-status={status}
                          tabIndex={day === focus ? 0 : -1}
                          aria-disabled={status === "outside" || undefined}
                          aria-label={`${formatUtcDate(day)}, ${STATUS_TEXT[status]}`}
                          className={`dp-day dp-${status}${inMonth ? "" : " dp-adjacent"}${chosen ? " dp-chosen" : ""}${within ? " dp-within" : ""}`}
                          onClick={() => choose(day)}
                          onKeyDown={(event) => {
                            const step: Record<string, string> = {
                              ArrowLeft: addDays(day, -1),
                              ArrowRight: addDays(day, 1),
                              ArrowUp: addDays(day, -7),
                              ArrowDown: addDays(day, 7),
                              Home: addDays(
                                day,
                                -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7),
                              ),
                              End: addDays(
                                day,
                                6 - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7),
                              ),
                              PageUp: addMonths(day, event.shiftKey ? -12 : -1),
                              PageDown: addMonths(day, event.shiftKey ? 12 : 1),
                            };
                            if (step[event.key]) {
                              event.preventDefault();
                              move(step[event.key]);
                            }
                          }}
                        >
                          {Number(day.slice(8))}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="daypicker-legend" aria-label="Legend">
            <li>
              <span className="dp-key dp-reading" aria-hidden="true" /> Reading
            </li>
            <li>
              <span className="dp-key dp-gap" aria-hidden="true" /> No reading
            </li>
            <li>
              <span className="dp-key dp-outside" aria-hidden="true" /> Not tracked
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
