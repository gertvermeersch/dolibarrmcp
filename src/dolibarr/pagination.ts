export const defaultPageSize = 100;
const defaultMaxPages = 10;

/**
 * Collect every page of a Dolibarr list endpoint. Dolibarr pages start at 0 and
 * signal the end with a short page, so a page smaller than `pageSize` stops the
 * loop. `maxPages` bounds the scan; callers treat the result as "all records"
 * only for the small volumes these tools are meant for.
 */
export async function listAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<T[]>,
  { pageSize = defaultPageSize, maxPages = defaultMaxPages }: { pageSize?: number; maxPages?: number } = {},
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(page, pageSize);
    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  return all;
}
