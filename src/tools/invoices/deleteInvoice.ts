import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteInvoice, getInvoice, setInvoiceDraft } from "../../dolibarr/invoices.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { runGuardedDelete } from "../shared/deleteGuards.js";

export function registerDeleteInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "delete_invoice",
    {
      description: "Delete a client invoice by numeric Dolibarr ID only. Requires confirm:true and MCP_ALLOW_DELETES=true.",
      inputSchema: {
        invoice_id: z.number().int().positive().describe("Dolibarr invoice ID"),
        confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
        reopen_if_validated: z.boolean().default(false).describe("Reopen non-draft invoices before deleting."),
        warehouse_id: z.number().int().positive().optional().describe("Warehouse ID to use when reopening a validated invoice that affects stock."),
      },
    },
    async ({ invoice_id, confirm, reopen_if_validated, warehouse_id }) =>
      runGuardedDelete({
        entityType: "invoice",
        entityLabel: "Invoice",
        idKey: "invoice_id",
        reopenFlag: "reopen_if_validated",
        id: invoice_id,
        confirm,
        reopen: reopen_if_validated,
        fetch: getInvoice,
        statusLabel: (invoice) => invoiceStatusLabel(invoice.statut),
        reopenToDraft: (id) => setInvoiceDraft(id, { warehouseId: warehouse_id }),
        remove: deleteInvoice,
      }),
  );
}
