import { resolveLine, type ResolveLineError } from "../../resolvers/product.js";
import type { DolibarrInvoiceLine } from "../../types/dolibarr.js";
import type { LineItemInput, LineResolution, McpError } from "../../types/tools.js";
import {
  isIsoDateString,
  numberOrUndefined,
  unixTimestampFromIsoDate,
} from "../../tools/shared/normalization.js";
import { hasLineChanges, mergeLineUpdate, type LineChanges } from "./lineUpdates.js";

export interface LineUpdateInput extends LineChanges {
  line_id: number;
}

export interface DocumentUpdateInput {
  /** Header changes keyed by tool input name. Date fields hold YYYY-MM-DD. */
  header: Record<string, string | undefined>;
  updateLines: LineUpdateInput[];
  addLines: LineItemInput[];
  removeLineIds: number[];
}

export interface UpdatableDocument {
  id: number | string;
  ref?: string;
  statut?: unknown;
  lines?: DolibarrInvoiceLine[];
}

export interface DocumentUpdateSuccess<Doc> {
  success: true;
  document: Doc;
  updated_fields: string[];
  updated_line_ids: number[];
  removed_line_ids: number[];
  added_lines: LineResolution[];
}

export interface DocumentUpdateValidationError extends McpError {
  error: "VALIDATION_ERROR";
  line_errors?: (ResolveLineError | { line_id: number; error: string })[];
}

export type DocumentUpdateResult<Doc> =
  | DocumentUpdateSuccess<Doc>
  | DocumentUpdateValidationError
  | McpError;

export interface DocumentUpdateApi<Doc> {
  get(id: number): Promise<Doc>;
  updateHeader(id: number, fields: Record<string, unknown>, current: Doc): Promise<unknown>;
  addLine(id: number, line: Partial<DolibarrInvoiceLine>): Promise<number>;
  updateLine(id: number, lineId: number, line: Partial<DolibarrInvoiceLine>): Promise<void>;
  deleteLine(id: number, lineId: number): Promise<void>;
}

export interface DocumentUpdateOptions<Doc> {
  /** Human-facing label used in error messages, e.g. "Invoice". */
  entityLabel: string;
  /** Tool name that can reopen the document, suggested when it is not draft. */
  reopenTool: string;
  /** Tool input name to Dolibarr field name for each updatable header field. */
  headerFields: Record<string, string>;
  /** Tool input names that take YYYY-MM-DD and are sent as timestamps. */
  dateFields?: string[];
  /** Entity-specific header checks against the current document. */
  validateHeader?: (fields: Record<string, unknown>, current: Doc) => string | undefined;
}

function validationError(
  message: string,
  lineErrors?: DocumentUpdateValidationError["line_errors"],
): DocumentUpdateValidationError {
  return {
    error: "VALIDATION_ERROR",
    message,
    ...(lineErrors ? { line_errors: lineErrors } : {}),
  };
}

/**
 * Apply header and line changes to a draft document. All inputs are checked
 * before the first write so a rejected request leaves the document untouched.
 *
 * Dolibarr's REST API accepts header updates on validated documents, and even
 * supplier invoice line edits, so the draft-only rule is enforced here.
 */
export class DocumentUpdateService<Doc extends UpdatableDocument> {
  constructor(
    private readonly api: DocumentUpdateApi<Doc>,
    private readonly options: DocumentUpdateOptions<Doc>,
  ) {}

  async update(document: Doc, input: DocumentUpdateInput): Promise<DocumentUpdateResult<Doc>> {
    const id = Number(document.id);
    const label = document.ref ? `${this.options.entityLabel} ${document.ref}` : this.options.entityLabel;

    if (numberOrUndefined(document.statut) !== 0) {
      return {
        error: "NOT_DRAFT",
        message: `${label} is not draft. Only draft documents can be updated.`,
        action: `Set it to draft with ${this.options.reopenTool} first, then retry the update.`,
      };
    }

    const headerEntries = Object.entries(input.header).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    );
    const updateLines = input.updateLines;

    if (
      headerEntries.length === 0 &&
      updateLines.length === 0 &&
      input.addLines.length === 0 &&
      input.removeLineIds.length === 0
    ) {
      return validationError("No changes requested.");
    }

    const dateFields = new Set(this.options.dateFields ?? []);
    const headerFields: Record<string, unknown> = {};
    for (const [field, value] of headerEntries) {
      const dolibarrField = this.options.headerFields[field];
      if (!dolibarrField) return validationError(`${field} is not an updatable field.`);

      if (dateFields.has(field)) {
        if (!isIsoDateString(value)) {
          return validationError(`${field} must be a valid YYYY-MM-DD calendar date.`);
        }
        headerFields[dolibarrField] = unixTimestampFromIsoDate(value);
      } else {
        headerFields[dolibarrField] = value;
      }
    }

    const headerError = headerEntries.length > 0
      ? this.options.validateHeader?.(headerFields, document)
      : undefined;
    if (headerError) return validationError(headerError);

    const existingLines = new Map(
      (document.lines ?? []).map((line) => [Number(line.id), line] as const),
    );
    const lineEditErrors: { line_id: number; error: string }[] = [];
    const touchedLineIds = new Set<number>();

    for (const { line_id, ...changes } of updateLines) {
      if (!hasLineChanges(changes)) {
        lineEditErrors.push({ line_id, error: `Line ${line_id} update lists no fields to change.` });
      }
    }

    for (const lineId of [...updateLines.map((line) => line.line_id), ...input.removeLineIds]) {
      if (!existingLines.has(lineId)) {
        lineEditErrors.push({ line_id: lineId, error: `Line ${lineId} does not belong to ${label}.` });
      } else if (touchedLineIds.has(lineId)) {
        lineEditErrors.push({ line_id: lineId, error: `Line ${lineId} is listed more than once.` });
      }
      touchedLineIds.add(lineId);
    }

    if (lineEditErrors.length > 0) {
      return validationError("One or more line edits are invalid.", lineEditErrors);
    }

    const addResults = await Promise.all(
      input.addLines.map((line, index) => resolveLine(line, index + 1)),
    );
    const addErrors = addResults.flatMap((result) => (result.ok ? [] : [result.error]));
    if (addErrors.length > 0) {
      return validationError("One or more new lines could not be resolved.", addErrors);
    }

    if (headerEntries.length > 0) {
      await this.api.updateHeader(id, headerFields, document);
    }

    for (const { line_id, ...changes } of updateLines) {
      const existing = existingLines.get(line_id);
      if (!existing) throw new Error(`Unexpected unknown line ${line_id} after validation.`);
      await this.api.updateLine(id, line_id, mergeLineUpdate(existing, changes));
    }

    for (const lineId of input.removeLineIds) {
      await this.api.deleteLine(id, lineId);
    }

    const addedLines: LineResolution[] = [];
    for (const result of addResults) {
      if (!result.ok) throw new Error("Unexpected unresolved line after validation.");
      await this.api.addLine(id, result.resolved.line);
      addedLines.push(result.resolved.resolution);
    }

    return {
      success: true,
      document: await this.api.get(id),
      updated_fields: headerEntries.map(([field]) => field),
      updated_line_ids: updateLines.map((line) => line.line_id),
      removed_line_ids: input.removeLineIds,
      added_lines: addedLines,
    };
  }
}
