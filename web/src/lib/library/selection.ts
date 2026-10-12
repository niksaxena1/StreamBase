export type SelectionState = { selected: Set<string>; anchor: string | null };

/**
 * One checkbox click. A plain click flips that row and remembers it (by catalog ID) as the anchor.
 * A shift-click sets every row between the anchor and the clicked row, in the CURRENT visible order,
 * to the state the clicked row is moving to. If the anchor isn't visible any more it is a plain click.
 * `ids` is the visible order (the filtered, sorted list).
 */
export function toggleInSelection(state: SelectionState, ids: string[], index: number, shift: boolean): SelectionState {
  const id = ids[index];
  if (id === undefined) return state;
  const checked = !state.selected.has(id);
  const next = new Set(state.selected);
  const anchorIndex = shift && state.anchor !== null ? ids.indexOf(state.anchor) : -1;
  if (anchorIndex >= 0) {
    const [from, to] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex];
    for (let i = from; i <= to; i++) {
      if (checked) next.add(ids[i]);
      else next.delete(ids[i]);
    }
  } else if (checked) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return { selected: next, anchor: id };
}

/** Header checkbox: select every visible row, or clear them when all are already selected. */
export function toggleAllInSelection(state: SelectionState, ids: string[]): SelectionState {
  const allSelected = ids.length > 0 && ids.every((id) => state.selected.has(id));
  return { selected: allSelected ? new Set() : new Set(ids), anchor: null };
}

/** Keeps only ids that are still visible. Returns the same set when nothing was dropped. */
export function pruneSelection(selected: Set<string>, visible: Set<string>): Set<string> {
  if (selected.size === 0) return selected;
  let dropped = false;
  const kept = new Set<string>();
  for (const id of selected) {
    if (visible.has(id)) kept.add(id);
    else dropped = true;
  }
  return dropped ? kept : selected;
}
