import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addInvoiceLine,
  deleteInvoiceLine,
  getInvoice,
  listInvoices,
  updateInvoice,
  updateInvoiceLine,
} from "../../dolibarr/invoices.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { DocumentUpdateService } from "../../dolibarr/documents/documentUpdateService.js";
import { documentUpdateResponse } from "../shared/documentUpdateResponse.js";
import { isoDateFromTimestamp } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import { documentLineEditsSchema } from "../shared/schemas.js";

const updateInvoiceService = new DocumentUpdateService(
  {
    get: getInvoice,
    updateHeader: updateInvoice,
    addLine: addInvoiceLine,
    updateLine: updateInvoiceLine,
    deleteLine: deleteInvoiceLine,
  },
  {
    entityLabel: "Invoice",
    reopenTool: "set_invoice_status (status: draft)",
    headerFields: {
      date: "date",
      customer_ref: "ref_client",
      note_public: "note_public",
      note_private: "note_private",
    },
    dateFields: ["date"],
  },
);

export function registerUpdateInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "update_invoice",
    {
      description: "Update a draft client invoice: header fields and line edits in one call. Only draft invoices can be updated; validation, payments, and status changes use their own tools.",
      inputSchema: {
        invoice: z.string().describe("Invoice reference (e.g. (PROV42)) or Dolibarr ID"),
        date: z.string().optional().describe("Invoice date (YYYY-MM-DD)"),
        customer_ref: z.string().optional().describe("Client's own reference, such as a PO number"),
        note_public: z.string().optional(),
        note_private: z.string().optional(),
        ...documentLineEditsSchema,
      },
    },
    async ({ invoice: invoiceInput, update_lines, add_lines, remove_line_ids, ...header }) => {
      const invoice = await resolveByIdOrRef(invoiceInput, { getById: getInvoice, list: listInvoices });
      if (!invoice) {
        return {
          error: "INVOICE_NOT_FOUND",
          message: `No client invoice found for '${invoiceInput}'.`,
        };
      }

      const result = await updateInvoiceService.update(invoice, {
        header,
        updateLines: update_lines,
        addLines: add_lines,
        removeLineIds: remove_line_ids,
      });

      return documentUpdateResponse(result, {
        idKey: "invoice_id",
        statusLabel: (updated) => invoiceStatusLabel(updated.statut),
        extra: (updated) => ({ date: isoDateFromTimestamp(updated.date) }),
      });
    },
  );
}
