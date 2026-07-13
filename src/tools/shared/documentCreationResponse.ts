import type { DocumentCreationResult } from "../../dolibarr/documents/documentCreationService.js";
import { dolibarrId } from "./normalization.js";

interface DocumentResponseFields {
  /** Response key for the created document's Dolibarr ID, e.g. "invoice_id". */
  idKey: string;
  /** Response key for the resolved thirdparty name, e.g. "client" or "supplier". */
  thirdpartyKey: string;
  /** Extra entity-specific fields, placed between thirdparty and validated. */
  extra?: Record<string, unknown>;
}

/**
 * Map a `DocumentCreationService` result to an MCP tool response.
 *
 * Errors (any result without `success`) are returned unchanged. On success the
 * shared shape is built with entity-specific field names supplied by the caller,
 * keeping input/response naming explicit at each tool's edge.
 */
export function documentCreationResponse(
  result: DocumentCreationResult,
  { idKey, thirdpartyKey, extra }: DocumentResponseFields,
): DocumentCreationResult | Record<string, unknown> {
  if (!("success" in result)) return result;

  return {
    success: true,
    [idKey]: dolibarrId(result.id),
    [thirdpartyKey]: result.thirdparty,
    ...extra,
    validated: result.validated,
    lines: result.lines,
  };
}
