import { isDolibarrNotFoundError } from "../../dolibarr/errors.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";

export interface IdOrRefResolver<T extends { id?: string | number }> {
  /** Fetch the full entity by numeric Dolibarr ID. */
  getById: (id: number) => Promise<T>;
  /** List entities from a query string, used to look up a reference. */
  list: (params: string) => Promise<T[]>;
  /**
   * SQL columns matched against the reference input, OR-ed together.
   * Defaults to the primary Dolibarr ref column.
   */
  refColumns?: string[];
}

/**
 * Resolve an entity from a user-supplied value that is either a numeric
 * Dolibarr ID or an exact reference.
 *
 * Numeric input is fetched directly, returning `undefined` on a Dolibarr 404
 * while rethrowing unexpected API errors. Reference input is looked up via
 * `list` (limited to one match) and then re-fetched by ID so callers always
 * receive the full entity shape.
 */
export async function resolveByIdOrRef<T extends { id?: string | number }>(
  value: string,
  { getById, list, refColumns = ["t.ref"] }: IdOrRefResolver<T>,
): Promise<T | undefined> {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    try {
      return await getById(Number(trimmed));
    } catch (err) {
      if (isDolibarrNotFoundError(err)) return undefined;
      throw err;
    }
  }

  const literal = dolibarrStringLiteral(trimmed);
  const sqlfilters = refColumns.map((column) => `(${column}:=:${literal})`).join(" OR ");
  const matches = await list(dolibarrQueryString({ sqlfilters, limit: "1" }));

  return matches[0] ? getById(Number(matches[0].id)) : undefined;
}
