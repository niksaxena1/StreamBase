/** PostgREST returns at most this many rows per request. */
export const POSTGREST_PAGE_SIZE = 1000;

/** Safety stop so a bad response can never loop forever (50 pages = 50k rows). */
const MAX_PAGES = 50;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

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
