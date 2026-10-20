import { z } from "zod";
import { isDolibarrNotFoundError } from "../../dolibarr/errors.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { isIsoDateString } from "./normalization.js";

export const paginationSchema = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 101).default(0),
};
export const thirdpartyFilterSchema = {
  thirdparty_id: z.number().int().positive().optional(),
};
const dateSchema = z.string().refine(isIsoDateString, "Expected a valid YYYY-MM-DD date");
export const dateRangeSchema = {
  date_from: dateSchema.optional().describe("Inclusive start date, YYYY-MM-DD"),
  date_to: dateSchema.optional().describe("Inclusive end date, YYYY-MM-DD"),
};

export function dateRangeError(options: { date_from?: string; date_to?: string }) {
  if (options.date_from && options.date_to && options.date_from > options.date_to) {
    return { error: "VALIDATION_ERROR", message: "date_from must be on or before date_to." };
  }
}

export function dateFilters(field: string, options: { date_from?: string; date_to?: string }): string[] {
  return [
    ...(options.date_from ? [`(${field}:>=:${dolibarrStringLiteral(options.date_from)})`] : []),
    ...(options.date_to ? [`(${field}:<=:${dolibarrStringLiteral(options.date_to)})`] : []),
  ];
}

// Dolibarr accepts page/limit, not an arbitrary offset. Fetch the overlapping
// pages, including one lookahead row, without scanning earlier pages.
export async function listWindow<T>(
  fetch: (params: string) => Promise<T[]>,
  params: Record<string, string>,
  limit: number,
  offset: number,
): Promise<{ rows: T[]; hasMore: boolean }> {
  const pageSize = 100;
  const skip = offset % pageSize;
  let page = Math.floor(offset / pageSize);
  const rows: T[] = [];
  while (rows.length < skip + limit + 1) {
    let batch: T[];
    try {
      batch = await fetch(dolibarrQueryString({
        sortfield: "t.rowid", sortorder: "DESC", ...params,
        limit: String(pageSize), page: String(page++),
      }));
    } catch (err) {
      if (!isDolibarrNotFoundError(err)) throw err;
      batch = [];
    }
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { rows: rows.slice(skip, skip + limit), hasMore: rows.length > skip + limit };
}

export function listResponse(key: string, rows: unknown[], limit: number, offset: number, hasMore: boolean) {
  return {
    [key]: rows, count: rows.length, limit, offset, has_more: hasMore,
    next_offset: hasMore ? offset + rows.length : null,
  };
}
