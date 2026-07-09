import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getSupplierInvoice,
  setSupplierInvoiceDraft,
  validateSupplierInvoice,
} from "../../dolibarr/supplierInvoices.js";
import { DolibarrApiError } from "../../dolibarr/errors.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { statusCode } from "../shared/deleteGuards.js";

function isAlreadyDraftError(err: unknown, invoiceId: number): boolean {
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/supplierinvoices/${invoiceId}/settodraft`
  );
}

function isAlreadyValidatedError(err: unknown, invoiceId: number): boolean {
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/supplierinvoices/${invoiceId}/validate`
  );
}

export function registerSetSupplierInvoiceStatus(server: McpServer): void {
  registerJsonTool(
    server,
    "set_supplier_invoice_status",
    {
      description: "Set a supplier invoice status to draft or validated. Draft reopens validated invoices and is idempotent.",
      inputSchema: {
        supplier_invoice_id: z.number().int().positive().describe("Dolibarr supplier invoice ID"),
        status: z.enum(["draft", "validated"]),
        notrigger: z.number().int().optional().describe("Set to 1 to disable Dolibarr triggers"),
      },
    },
    async ({ supplier_invoice_id, status, notrigger }) => {
      const invoice = await getSupplierInvoice(supplier_invoice_id);
      const currentStatus = statusCode(invoice.statut);

      if (status === "draft") {
        if (currentStatus === 0) {
          return {
            success: true,
            supplier_invoice_id,
            status: "draft",
            note: "Already draft.",
          };
        }

        try {
          await setSupplierInvoiceDraft(supplier_invoice_id, { notrigger });
        } catch (err) {
          if (!isAlreadyDraftError(err, supplier_invoice_id)) throw err;
        }

        return {
          success: true,
          supplier_invoice_id,
          status: "draft",
        };
      }

      if (currentStatus === 1) {
        return {
          success: true,
          supplier_invoice_id,
          status: "validated",
          note: "Already validated.",
        };
      }

      try {
        await validateSupplierInvoice(supplier_invoice_id, { notrigger });
      } catch (err) {
        if (!isAlreadyValidatedError(err, supplier_invoice_id)) throw err;
      }

      return {
        success: true,
        supplier_invoice_id,
        status: "validated",
      };
    },
  );
}
