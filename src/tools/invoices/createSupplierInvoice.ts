import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSupplierInvoice, addSupplierInvoiceLine, validateSupplierInvoice } from "../../dolibarr/supplierInvoices.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent } from "../shared/responses.js";
import { lineSchema } from "../shared/schemas.js";

const createSupplierInvoiceService = new DocumentCreationService({
  create: createSupplierInvoice,
  addLine: addSupplierInvoiceLine,
  validate: validateSupplierInvoice,
});

export function registerCreateSupplierInvoice(server: McpServer): void {
  server.tool(
    "create_supplier_invoice",
    "Create a supplier invoice with lines. Resolves the supplier by name and catalog products/services where possible.",
    {
      supplier: z.string().describe("Supplier name or Dolibarr ID"),
      date: z.string().describe("Invoice date (YYYY-MM-DD)"),
      lines: z.array(lineSchema).min(1),
      validate: z.boolean().default(false).describe("Validate the invoice immediately after creation"),
    },
    async ({ supplier, date, lines, validate }) => {
      try {
        const result = await createSupplierInvoiceService.create({
          thirdparty: supplier,
          date,
          lines,
          validate,
        });
        return jsonContent(
          "success" in result
            ? {
                success: true,
                invoice_id: result.id,
                supplier: result.thirdparty,
                validated: result.validated,
                lines: result.lines,
              }
            : result,
        );
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
