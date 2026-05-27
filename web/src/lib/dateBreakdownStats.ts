import { addDaysISO } from "@/lib/sotDates";

/**
 * Average of the 7 data dates immediately before `dataDate` (exclusive).
 * Matches chart tooltip prior-window semantics on data-date axis.
 */
export function prior7DayAverageDaily(byDataDate: Map<string, number>, dataDate: string): number {
  const values: number[] = [];
  for (let i = 7; i >= 1; i--) {
    values.push(byDataDate.get(addDaysISO(dataDate, -i)) ?? 0);
  }
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
