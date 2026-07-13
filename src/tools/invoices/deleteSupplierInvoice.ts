import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  deleteSupplierInvoice,
  getSupplierInvoice,
  setSupplierInvoiceDraft,
} from "../../dolibarr/supplierInvoices.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { runGuardedDelete } from "../shared/deleteGuards.js";

export function registerDeleteSupplierInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "delete_supplier_invoice",
    {
      description: "Delete a supplier invoice by numeric Dolibarr ID only. Requires confirm:true and MCP_ALLOW_DELETES=true.",
      inputSchema: {
        supplier_invoice_id: z.number().int().positive().describe("Dolibarr supplier invoice ID"),
        confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
        reopen_if_validated: z.boolean().default(false).describe("Reopen non-draft invoices before deleting."),
      },
    },
    async ({ supplier_invoice_id, confirm, reopen_if_validated }) =>
      runGuardedDelete({
        entityType: "supplier_invoice",
        entityLabel: "Supplier invoice",
        idKey: "supplier_invoice_id",
        reopenFlag: "reopen_if_validated",
        id: supplier_invoice_id,
        confirm,
        reopen: reopen_if_validated,
        fetch: getSupplierInvoice,
        statusLabel: (invoice) => invoiceStatusLabel(invoice.statut),
        reopenToDraft: setSupplierInvoiceDraft,
        remove: deleteSupplierInvoice,
      }),
  );
}
