import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  deleteSupplierInvoice,
  getSupplierInvoice,
  setSupplierInvoiceDraft,
} from "../../dolibarr/supplierInvoices.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent } from "../shared/responses.js";
import {
  deleteDryRun,
  deletesDisabledResponse,
  mustReopenResponse,
  statusCode,
} from "../shared/deleteGuards.js";

export function registerDeleteSupplierInvoice(server: McpServer): void {
  server.registerTool(
    "delete_supplier_invoice",
    {
      description: "Delete a supplier invoice by numeric Dolibarr ID only. Requires confirm:true and MCP_ALLOW_DELETES=true.",
      inputSchema: {
        supplier_invoice_id: z.number().int().positive().describe("Dolibarr supplier invoice ID"),
        confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
        reopen_if_validated: z.boolean().default(false).describe("Reopen non-draft invoices before deleting."),
      },
    },
    async ({ supplier_invoice_id, confirm, reopen_if_validated }) => {
      try {
        const disabled = deletesDisabledResponse();
        if (disabled) return jsonContent(disabled);

        const invoice = await getSupplierInvoice(supplier_invoice_id);
        const status = invoiceStatusLabel(invoice.statut);

        if (!confirm) {
          return jsonContent(deleteDryRun({
            entity_type: "supplier_invoice",
            id: supplier_invoice_id,
            ref: invoice.ref,
            status,
          }));
        }

        if (statusCode(invoice.statut) !== 0) {
          if (!reopen_if_validated) {
            return jsonContent(mustReopenResponse("Supplier invoice", invoice.ref, "reopen_if_validated"));
          }

          await setSupplierInvoiceDraft(supplier_invoice_id);
        }

        await deleteSupplierInvoice(supplier_invoice_id);

        return jsonContent({
          success: true,
          deleted: true,
          supplier_invoice_id,
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
