import { DolibarrApiError } from "../../dolibarr/errors.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { dolibarrId } from "./normalization.js";
import { thirdpartyNameMap } from "./serializers.js";
import type { DolibarrThirdparty } from "../../types/dolibarr.js";

// A module the API user cannot read (403) or an empty result (404) is not a
// failure for a cross-domain lookup; it just contributes nothing.
export async function optionalSearch<T>(search: () => Promise<T[]>): Promise<T[]> {
  try {
    return await search();
  } catch (err) {
    if (err instanceof DolibarrApiError && (err.status === 403 || err.status === 404)) return [];
    throw err;
  }
}

// Thirdparty names for `ids`, reusing already-fetched thirdparties and fetching
// only the missing ones.
export async function resolveMissingThirdpartyNames(
  ids: number[],
  knownThirdparties: DolibarrThirdparty[] = [],
): Promise<Map<number, string>> {
  const names = thirdpartyNameMap(knownThirdparties);
  const missingIds = [...new Set(ids)].filter((id) => !names.has(id));

  const missingThirdparties = await Promise.all(
    missingIds.map((id) => optionalSearch(() => getThirdparty(id).then((thirdparty) => [thirdparty]))),
  );

  for (const thirdparty of missingThirdparties.flat()) {
    names.set(dolibarrId(thirdparty.id), thirdparty.name);
  }

  return names;
}
