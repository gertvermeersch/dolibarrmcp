import { isDolibarrNotFoundError } from "../dolibarr/client.js";
import { getThirdparty, getThirdpartyType, searchThirdparties } from "../dolibarr/thirdparties.js";
import type { McpError, ThirdpartyCandidate } from "../types/tools.js";

export type ThirdpartyResolveResult =
  | { ok: true; id: number; name: string }
  | { ok: false; error: McpError };

export async function resolveThirdparty(
  query: string,
): Promise<ThirdpartyResolveResult> {
  const trimmedQuery = query.trim();
  const id = Number(trimmedQuery);

  if (Number.isInteger(id) && id > 0 && String(id) === trimmedQuery) {
    try {
      const thirdparty = await getThirdparty(id);
      return { ok: true, id: Number(thirdparty.id), name: thirdparty.name };
    } catch (err) {
      if (!isDolibarrNotFoundError(err)) throw err;
    }
  }

  const results = await searchThirdparties(trimmedQuery);

  if (results.length === 0) {
    return {
      ok: false,
      error: {
        error: "THIRDPARTY_NOT_FOUND",
        message: `No thirdparty found matching '${trimmedQuery}'.`,
        action: "Run create_thirdparty to create it, or refine your search term.",
      },
    };
  }

  if (results.length === 1) {
    return { ok: true, id: Number(results[0].id), name: results[0].name };
  }

  // Multiple matches — return candidates for the user to confirm
  const candidates: ThirdpartyCandidate[] = results.map((t) => {
    const type = getThirdpartyType(t);

    return {
      id: Number(t.id),
      name: t.name,
      type: type === "other" ? "client" : type,
    };
  });

  return {
    ok: false,
    error: {
      error: "THIRDPARTY_AMBIGUOUS",
      message: `Found ${results.length} thirdparties matching '${trimmedQuery}'. Please confirm which one to use.`,
      candidates,
    },
  };
}
