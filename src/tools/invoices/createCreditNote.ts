import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CreditNoteService } from "../../dolibarr/documents/creditNoteService.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { dolibarrId, money, remainingToPay, isPaidInvoice } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { lineSchema } from "../shared/schemas.js";

const creditNoteService = new CreditNoteService();

export function registerCreateCreditNote(server: McpServer): void {
  registerJsonTool(
    server,
    "create_credit_note",
    {
      description: "Create a credit note (creditnota / avoir) for a validated or paid client invoice and link it to that invoice. The client is taken from the invoice. Use mode 'full' to credit every line of the invoice, or mode 'partial' with lines to credit part of it. Give lines as positive quantities and prices; Dolibarr makes the amounts negative. Refuses to credit more than the invoice total minus earlier credit notes. This tool does not refund money or apply the credit to the invoice.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        invoice: z.string().describe("Reference (e.g. FA2024-0042) or Dolibarr ID of the invoice to credit"),
        mode: z.enum(["full", "partial"]).describe("'full' copies all invoice lines. 'partial' credits only the given lines."),
        lines: z.array(lineSchema).optional().describe("Lines to credit, for mode 'partial' only. Positive quantities and prices."),
        date: z.string().optional().describe("Credit note date (YYYY-MM-DD). Defaults to today."),
        reason: z.string().optional().describe("Reason for the credit note. Stored as a private note, not printed on the document."),
        validate: z.boolean().default(false).describe("Validate (confirm) the credit note immediately after creation"),
      },
    },
    async ({ invoice, mode, lines, date, reason, validate }) => {
      const result = await creditNoteService.create({ invoice, mode, lines, date, reason, validate });
      if (!("success" in result)) return result;

      const { creditNote, source } = result;
      const totalExcludingTax = Math.abs(Number(creditNote.total_ht));
      const totalIncludingTax = Math.abs(Number(creditNote.total_ttc));

      return {
        success: true,
        credit_note_id: dolibarrId(creditNote.id),
        credit_note_ref: creditNote.ref,
        invoice: {
          id: dolibarrId(source.id),
          ref: source.ref,
          status: invoiceStatusLabel(source.statut),
          paid: isPaidInvoice(source),
          remaining_to_pay: remainingToPay(source),
          total_including_tax: money(source.total_ttc),
        },
        mode,
        credited_excluding_tax: money(totalExcludingTax),
        credited_including_tax: money(totalIncludingTax),
        already_credited_excluding_tax: result.alreadyCreditedExcludingTax,
        validated: result.validated,
        linked_to_invoice: result.linkedToInvoice,
        lines: result.lines,
        ...(result.linkedToInvoice
          ? {}
          : { warning: "The credit note was created but Dolibarr did not store the link to the invoice. Check it in Dolibarr." }),
        note: "The credit note is not yet applied to the invoice or refunded; do that in Dolibarr.",
      };
    },
  );
}
