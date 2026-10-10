export type PageScheduler = <T>(work: () => PromiseLike<T>) => Promise<T>;

/** Share a paging limit across independent labels in an all-competitors load. */
export function createPageScheduler(concurrency = 4): PageScheduler {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(work: () => PromiseLike<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Fetch counted pages in groups of four, merging in the original range order. */
export async function fetchOrderedPages<T>(args: {
  pageSize: number;
  maxRows: number;
  fetchPage: (offset: number, withCount: boolean) => PromiseLike<{ data: T[] | null; count?: number | null }>;
}): Promise<T[]> {
  const { pageSize, maxRows, fetchPage } = args;
  if (maxRows <= 0) return [];
  const first = await fetchPage(0, true);
  const out = [...(first.data ?? [])];
  if (out.length < pageSize) return out;

  const count = first.count;
  if (count == null || !Number.isFinite(count) || count < out.length) {
    // Older endpoints may omit Content-Range. Preserve the sequential fallback.
    for (let offset = pageSize; offset < maxRows; offset += pageSize) {
      const { data } = await fetchPage(offset, false);
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  // Include the original empty terminal page when count is an exact multiple.
  // maxRows historically bounds page starts, rather than truncating the last page.
  const end = Math.min(maxRows, (Math.floor(count / pageSize) + 1) * pageSize);
  for (let offset = pageSize; offset < end; offset += pageSize * 4) {
    const offsets = Array.from({ length: Math.min(4, Math.ceil((end - offset) / pageSize)) }, (_, i) => offset + i * pageSize);
    const pages = await Promise.all(offsets.map((from) => fetchPage(from, false)));
    for (const { data } of pages) {
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < pageSize) return out;
    }
  }
  // The first count is only a scheduling hint: ingestion may append rows while
  // these pages are in flight. A full final page needs the original sequential
  // continuation, bounded by page starts just as in the legacy loop.
  for (let offset = end; offset < maxRows; offset += pageSize) {
    const { data } = await fetchPage(offset, false);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
