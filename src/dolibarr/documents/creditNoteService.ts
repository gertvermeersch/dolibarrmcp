import { resolveLine, type ResolveLineError } from "../../resolvers/product.js";
import { resolveByIdOrRef } from "../../tools/shared/resolveByIdOrRef.js";
import {
  isIsoDateString,
  money,
  numberOrUndefined,
  numberOrZero,
  unixTimestampFromIsoDate,
} from "../../tools/shared/normalization.js";
import { dolibarrQueryString } from "../sqlFilters.js";
import { todayIso } from "../maintenance/contractRules.js";
import { addInvoiceLine, createInvoice, getInvoice, listInvoices, validateInvoice } from "../invoices.js";
import { CREDIT_NOTE_TYPE_CODE } from "../statusLabels.js";
import type { DolibarrInvoice, DolibarrInvoiceLine } from "../../types/dolibarr.js";
import type { LineItemInput, LineResolution, McpError } from "../../types/tools.js";

export interface CreditNoteInput {
  /** Reference or Dolibarr ID of the invoice being credited. */
  invoice: string;
  mode: "full" | "partial";
  /** Lines to credit, with positive quantities and prices. Required for partial mode only. */
  lines?: LineItemInput[];
  /** Credit note date (YYYY-MM-DD); defaults to today. */
  date?: string;
  /** Stored as the private note; not printed on the document. */
  reason?: string;
  validate: boolean;
}

export interface CreditNoteSuccess {
  success: true;
  creditNote: DolibarrInvoice;
  source: DolibarrInvoice;
  validated: boolean;
  linkedToInvoice: boolean;
  alreadyCreditedExcludingTax: number;
  lines: LineResolution[];
}

export interface CreditNoteValidationError extends McpError {
  line_errors?: ResolveLineError[];
}

// The credit note exists as a draft but a later step failed. Nothing is deleted.
export interface CreditNotePartialFailure extends McpError {
  credit_note_id: number;
  failed_step: string;
}

export type CreditNoteResult = CreditNoteSuccess | CreditNoteValidationError | CreditNotePartialFailure | McpError;

const STATUS_VALIDATED = 1;
const STATUS_PAID = 2;
const STATUS_ABANDONED = 3;
const TYPE_CREDIT_NOTE = CREDIT_NOTE_TYPE_CODE;
const TYPE_SPECIAL_LINE = 9; // Subtotal and title lines from add-on modules.
const ROUNDING = 0.005;

const validationError = (message: string, action?: string): McpError => ({
  error: "VALIDATION_ERROR",
  message,
  ...(action ? { action } : {}),
});

/** Total excl. tax of lines given as positive quantities and prices. */
function linesTotal(lines: Array<Partial<DolibarrInvoiceLine>>): number {
  return lines.reduce(
    (sum, line) =>
      sum + numberOrZero(line.qty) * numberOrZero(line.subprice) * (1 - numberOrZero(line.remise_percent) / 100),
    0,
  );
}

// Free-text lines come back from Dolibarr with fk_product 0 or empty.
function catalogProductId(line: DolibarrInvoiceLine): number | undefined {
  const id = numberOrUndefined(line.fk_product);
  return id !== undefined && id > 0 ? id : undefined;
}

/** Copy a source invoice line for a credit note. Dolibarr itself negates the amounts. */
function copiedLine(line: DolibarrInvoiceLine): Partial<DolibarrInvoiceLine> {
  const productId = catalogProductId(line);
  return {
    desc: line.desc,
    qty: line.qty,
    subprice: line.subprice,
    tva_tx: line.tva_tx,
    ...(productId ? { fk_product: productId } : {}),
    ...(line.product_type !== undefined ? { product_type: line.product_type } : {}),
    ...(line.remise_percent ? { remise_percent: line.remise_percent } : {}),
    ...(line.date_start ? { date_start: line.date_start } : {}),
    ...(line.date_end ? { date_end: line.date_end } : {}),
  };
}

export class CreditNoteService {
  async create(input: CreditNoteInput): Promise<CreditNoteResult> {
    if (input.mode === "partial" && (!input.lines || input.lines.length === 0)) {
      return validationError("Partial mode needs at least one line to credit.", "Pass lines, or use mode 'full' to credit the whole invoice.");
    }
    if (input.mode === "full" && input.lines && input.lines.length > 0) {
      return validationError("Full mode credits the whole invoice and takes no lines.", "Remove lines, or use mode 'partial'.");
    }

    const date = input.date ?? todayIso();
    if (!isIsoDateString(date)) return validationError("Date must be a valid YYYY-MM-DD calendar date.");

    const source = await resolveByIdOrRef(input.invoice, { getById: getInvoice, list: listInvoices });
    if (!source) {
      return {
        error: "INVOICE_NOT_FOUND",
        message: `No client invoice found for '${input.invoice}'.`,
        action: "Run list_invoices to find the invoice ref or ID.",
      };
    }

    const sourceStatus = Number(source.statut);
    if (numberOrUndefined(source.type) === TYPE_CREDIT_NOTE) {
      return validationError(`${source.ref} is a credit note itself and cannot be credited.`);
    }
    if (sourceStatus !== STATUS_VALIDATED && sourceStatus !== STATUS_PAID) {
      return validationError(
        `${source.ref} is ${sourceStatus === STATUS_ABANDONED ? "abandoned" : "still a draft"}; only validated or paid invoices can be credited.`,
        sourceStatus === STATUS_ABANDONED
          ? "An abandoned invoice needs no credit note."
          : "Edit or delete the draft instead, or validate it first.",
      );
    }

    const alreadyCredited = await this.existingCreditNotes(Number(source.id));
    const alreadyCreditedHt = alreadyCredited.reduce((sum, note) => sum + Math.abs(numberOrZero(note.total_ht)), 0);

    const prepared = input.mode === "full"
      ? this.fullLines(source, alreadyCredited)
      : await this.partialLines(input.lines ?? []);
    if ("error" in prepared) return prepared;

    const creditable = numberOrZero(source.total_ht) - alreadyCreditedHt;
    const total = linesTotal(prepared.lines);
    if (total > creditable + ROUNDING) {
      return {
        error: "CREDIT_EXCEEDS_INVOICE",
        message: `Crediting ${money(total)} excl. tax exceeds the ${money(Math.max(0, creditable))} still creditable on ${source.ref} (invoice ${money(source.total_ht)}, already credited ${money(alreadyCreditedHt)}).`,
        action: "Lower the quantities or prices, or use get_invoice_detail to check the invoice.",
      };
    }

    const socid = numberOrUndefined(source.socid);
    if (socid === undefined) return validationError(`${source.ref} has no thirdparty.`);

    const creditNoteId = await createInvoice({
      socid,
      date: unixTimestampFromIsoDate(date),
      type: TYPE_CREDIT_NOTE,
      fk_facture_source: Number(source.id),
      ...(input.reason ? { note_private: input.reason } : {}),
    });

    let step = "add lines";
    try {
      for (const line of prepared.lines) await addInvoiceLine(creditNoteId, line);

      if (input.validate) {
        step = "validate credit note";
        await validateInvoice(creditNoteId);
      }

      // Dolibarr silently ignores unsupported fields, so confirm the link on what was stored.
      step = "verify credit note";
      const creditNote = await getInvoice(creditNoteId);

      return {
        success: true,
        creditNote,
        source,
        validated: input.validate,
        linkedToInvoice: numberOrUndefined(creditNote.fk_facture_source) === Number(source.id),
        alreadyCreditedExcludingTax: money(alreadyCreditedHt) ?? 0,
        lines: prepared.resolutions,
      };
    } catch (err) {
      return {
        error: "DOLIBARR_API_ERROR",
        message: `Credit note ${creditNoteId} was created, but the step '${step}' failed: ${err instanceof Error ? err.message : String(err)}. Nothing was deleted; inspect it with get_invoice_detail.`,
        action: "Complete or remove the draft credit note in Dolibarr, then retry.",
        credit_note_id: creditNoteId,
        failed_step: step,
      } satisfies CreditNotePartialFailure;
    }
  }

  private async existingCreditNotes(sourceId: number): Promise<DolibarrInvoice[]> {
    const notes = await listInvoices(dolibarrQueryString({
      sqlfilters: `(t.fk_facture_source:=:${sourceId}) AND (t.type:=:${TYPE_CREDIT_NOTE})`,
      withLines: "false",
      limit: "100",
    }));
    // Abandoned credit notes were cancelled and no longer reduce what can be credited.
    return notes.filter((note) => Number(note.statut) !== STATUS_ABANDONED);
  }

  private fullLines(
    source: DolibarrInvoice,
    alreadyCredited: DolibarrInvoice[],
  ): { lines: Array<Partial<DolibarrInvoiceLine>>; resolutions: LineResolution[] } | McpError {
    if (alreadyCredited.length > 0) {
      return validationError(
        `${source.ref} already has credit note(s) ${alreadyCredited.map((note) => note.ref).join(", ")}, so it cannot be credited in full again.`,
        "Use mode 'partial' with the remaining amounts.",
      );
    }

    const sourceLines = (source.lines ?? []).filter((line) => numberOrUndefined(line.product_type) !== TYPE_SPECIAL_LINE);
    if (sourceLines.length === 0) return validationError(`${source.ref} has no lines to credit.`);

    if (sourceLines.some((line) => numberOrZero(line.qty) < 0 || numberOrZero(line.subprice) < 0)) {
      return validationError(
        `${source.ref} contains negative or discount lines, which a full credit note would not reverse correctly.`,
        "Use mode 'partial' and list the lines to credit.",
      );
    }

    return {
      lines: sourceLines.map(copiedLine),
      resolutions: sourceLines.map((line, index) => ({
        index: index + 1,
        resolved: catalogProductId(line) !== undefined,
        ...(line.product_ref ? { product_ref: line.product_ref } : {}),
        label: line.desc || line.product_label || "",
        note: "Copied from the invoice",
      })),
    };
  }

  private async partialLines(
    inputs: LineItemInput[],
  ): Promise<{ lines: Array<Partial<DolibarrInvoiceLine>>; resolutions: LineResolution[] } | CreditNoteValidationError> {
    const results = await Promise.all(inputs.map((line, index) => resolveLine(line, index + 1)));
    const lineErrors = results.flatMap((result) => (result.ok ? [] : [result.error]));

    inputs.forEach((line, index) => {
      if (line.unit_price !== undefined && line.unit_price < 0) {
        lineErrors.push({ index: index + 1, error: `Line ${index + 1}: unit_price must be positive; the credit note makes it negative itself.` });
      }
    });

    if (lineErrors.length > 0) {
      return { error: "VALIDATION_ERROR", message: "One or more lines could not be resolved.", line_errors: lineErrors };
    }

    const resolved = results.map((result) => {
      if (!result.ok) throw new Error("Unexpected unresolved line after validation.");
      return result.resolved;
    });

    return { lines: resolved.map((entry) => entry.line), resolutions: resolved.map((entry) => entry.resolution) };
  }
}
