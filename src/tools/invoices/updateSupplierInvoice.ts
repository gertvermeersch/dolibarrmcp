import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addSupplierInvoiceLine,
  deleteSupplierInvoiceLine,
  getSupplierInvoice,
  listSupplierInvoices,
  updateSupplierInvoice,
  updateSupplierInvoiceLine,
} from "../../dolibarr/supplierInvoices.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { DocumentUpdateService } from "../../dolibarr/documents/documentUpdateService.js";
import { documentUpdateResponse } from "../shared/documentUpdateResponse.js";
import { isoDateFromTimestamp } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import { documentLineEditsSchema } from "../shared/schemas.js";
import type { DolibarrInvoice } from "../../types/dolibarr.js";

const updateSupplierInvoiceService = new DocumentUpdateService(
  {
    get: getSupplierInvoice,
    updateHeader: updateSupplierInvoice,
    addLine: addSupplierInvoiceLine,
    updateLine: updateSupplierInvoiceLine,
    deleteLine: deleteSupplierInvoiceLine,
  },
  {
    entityLabel: "Supplier invoice",
    reopenTool: "set_supplier_invoice_status (status: draft)",
    headerFields: {
      date: "date",
      supplier_invoice_ref: "ref_supplier",
      label: "label",
      note_public: "note_public",
      note_private: "note_private",
    },
    dateFields: ["date"],
  },
);

export function registerUpdateSupplierInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "update_supplier_invoice",
    {
      description: "Update a draft supplier invoice: header fields and line edits in one call. Only draft invoices can be updated; validation, payments, and status changes use their own tools.",
      inputSchema: {
        supplier_invoice: z.string().describe("Supplier invoice reference, supplier's own reference, or Dolibarr ID"),
        date: z.string().optional().describe("Invoice date (YYYY-MM-DD)"),
        supplier_invoice_ref: z.string().min(1).optional().describe("Supplier's invoice reference/number. Must be unique for this supplier."),
        label: z.string().optional(),
        note_public: z.string().optional(),
        note_private: z.string().optional(),
        ...documentLineEditsSchema,
      },
      errorContext: ({ supplier_invoice_ref }) => ({ supplierInvoiceRef: supplier_invoice_ref }),
    },
    async ({ supplier_invoice: invoiceInput, update_lines, add_lines, remove_line_ids, ...header }) => {
      const invoice = await resolveByIdOrRef(invoiceInput, {
        getById: getSupplierInvoice,
        list: listSupplierInvoices,
        refColumns: ["t.ref", "t.ref_supplier"],
      });
      if (!invoice) {
        return {
          error: "SUPPLIER_INVOICE_NOT_FOUND",
          message: `No supplier invoice found for '${invoiceInput}'.`,
        };
      }

      const result = await updateSupplierInvoiceService.update(invoice, {
        header,
        updateLines: update_lines,
        addLines: add_lines,
        removeLineIds: remove_line_ids,
      });

      return documentUpdateResponse(result, {
        idKey: "invoice_id",
        statusLabel: (updated) => invoiceStatusLabel(updated.statut),
        extra: (updated) => ({
          supplier_invoice_ref: (updated as DolibarrInvoice & { ref_supplier?: string }).ref_supplier,
          date: isoDateFromTimestamp(updated.date),
        }),
      });
    },
  );
}
