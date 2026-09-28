import type {
  DocumentUpdateResult,
  UpdatableDocument,
} from "../../dolibarr/documents/documentUpdateService.js";
import { dolibarrId, money } from "./normalization.js";
import { serializeLineItem } from "./serializers.js";

type UpdatedDocument = UpdatableDocument & {
  total_ht?: unknown;
  total_tva?: unknown;
  total_ttc?: unknown;
};

interface DocumentUpdateResponseFields<Doc> {
  /** Response key for the document's Dolibarr ID, e.g. "invoice_id". */
  idKey: string;
  statusLabel: (document: Doc) => string | undefined;
  /** Extra entity-specific fields read from the updated document. */
  extra?: (document: Doc) => Record<string, unknown>;
}

/**
 * Map a `DocumentUpdateService` result to an MCP tool response. Errors are
 * returned unchanged; on success the re-fetched document is summarized so the
 * caller sees the resulting totals and line IDs without a follow-up read.
 */
export function documentUpdateResponse<Doc extends UpdatedDocument>(
  result: DocumentUpdateResult<Doc>,
  { idKey, statusLabel, extra }: DocumentUpdateResponseFields<Doc>,
): Record<string, unknown> {
  if (!("success" in result)) return { ...result };

  const { document } = result;
  const raw = document as Doc & Record<string, unknown>;

  return {
    success: true,
    [idKey]: dolibarrId(document.id),
    ref: document.ref,
    status: statusLabel(document),
    ...extra?.(document),
    changes: {
      updated_fields: result.updated_fields,
      updated_line_ids: result.updated_line_ids,
      removed_line_ids: result.removed_line_ids,
      added_lines: result.added_lines,
    },
    totals: {
      total_excluding_tax: money(raw.total_ht),
      total_tax: money(raw.total_tva),
      total_including_tax: money(raw.total_ttc),
    },
    lines: (document.lines ?? []).map(serializeLineItem),
  };
}
