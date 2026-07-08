import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInvoice, setInvoiceDraft, validateInvoice } from "../../dolibarr/invoices.js";
import { DolibarrApiError, toApiError } from "../../dolibarr/client.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { jsonContent } from "../shared/responses.js";
import { statusCode } from "../shared/deleteGuards.js";

function isAlreadyDraftError(err: unknown, invoiceId: number): boolean {
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/invoices/${invoiceId}/settodraft`
  );
}

function isAlreadyValidatedError(err: unknown, invoiceId: number): boolean {
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/invoices/${invoiceId}/validate`
  );
}

export function registerSetInvoiceStatus(server: McpServer): void {
  server.registerTool(
    "set_invoice_status",
    {
      description: "Set a client invoice status to draft or validated. Draft reopens validated invoices and is idempotent.",
      inputSchema: {
        invoice_id: z.number().int().positive().describe("Dolibarr invoice ID"),
        status: z.enum(["draft", "validated", "abandoned"]),
        warehouse_id: z.number().int().positive().optional().describe("Warehouse ID to use when reopening a validated invoice that affects stock."),
        notrigger: z.number().int().optional().describe("Set to 1 to disable Dolibarr triggers when supported by the selected transition."),
      },
    },
    async ({ invoice_id, status, warehouse_id, notrigger }) => {
      try {
        const invoice = await getInvoice(invoice_id);
        const currentStatus = statusCode(invoice.statut);

        if (status === "draft") {
          if (currentStatus === 0) {
            return jsonContent({
              success: true,
              invoice_id,
              status: "draft",
              note: "Already draft.",
            });
          }

          try {
            await setInvoiceDraft(invoice_id, { warehouseId: warehouse_id });
          } catch (err) {
            if (!isAlreadyDraftError(err, invoice_id)) throw err;
          }

          return jsonContent({
            success: true,
            invoice_id,
            status: "draft",
          });
        }

        if (status === "validated") {
          if (currentStatus === 1) {
            return jsonContent({
              success: true,
              invoice_id,
              status: "validated",
              note: "Already validated.",
            });
          }

          try {
            await validateInvoice(invoice_id, { notrigger });
          } catch (err) {
            if (!isAlreadyValidatedError(err, invoice_id)) throw err;
          }

          return jsonContent({
            success: true,
            invoice_id,
            status: "validated",
          });
        }

        if (currentStatus === 3) {
          return jsonContent({
            success: true,
            invoice_id,
            status: "abandoned",
            note: "Already abandoned.",
          });
        }

        return jsonContent({
          error: "UNSUPPORTED_STATUS",
          message: `Dolibarr's REST API does not expose a safe abandon transition for invoice ${invoice.ref}. Use the Dolibarr UI if this invoice must be abandoned.`,
          current_status: invoiceStatusLabel(invoice.statut),
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
