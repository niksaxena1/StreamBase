export const CONCENTRATION_TRACK_HEIGHT = 48;
export const CONCENTRATION_DIVIDER_HEIGHT = 16;
export const CONCENTRATION_HEADER_HEIGHT = 32;

/** null is the threshold divider; track indices still refer to the full sorted data. */
export function buildConcentrationTableRows(trackCount: number, thresholdIndex: number): Array<number | null> {
  const rows: Array<number | null> = [];
  for (let i = 0; i < trackCount; i++) {
    rows.push(i);
    if (i === thresholdIndex && i < trackCount - 1) rows.push(null);
  }
  return rows;
}
