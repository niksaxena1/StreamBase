/** PostgREST returns at most this many rows per request. */
export const POSTGREST_PAGE_SIZE = 1000;

/** Safety stop so a bad response can never loop forever (50 pages = 50k rows). */
const MAX_PAGES = 50;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Reads every row in key order, one page at a time, each page starting after the
 * last key of the previous one. Unlike offset paging, rows inserted or removed
 * between pages can't shift a page boundary, so nothing is skipped or repeated.
 * `keyOf` must return a unique, strictly ascending key (the sort column).
 */
export async function fetchAllByKeyset<T>(
  fetchAfter: (afterKey: string | null, limit: number) => PromiseLike<PageResult<T>>,
  keyOf: (row: T) => string,
  pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await fetchAfter(after, pageSize);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    const next = keyOf(batch[batch.length - 1]);
    if (next === after) break; // keys not advancing: stop rather than loop
    after = next;
  }
  return rows;
}

/**
 * Reads every row by walking `.range(from, to)` pages until one comes back
 * shorter than the page size. `fetchPage` gets inclusive range bounds.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * pageSize;
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
