import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSupplierInvoice, addSupplierInvoiceLine, validateSupplierInvoice } from "../../dolibarr/supplierInvoices.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { toApiError } from "../../dolibarr/client.js";
import { dolibarrId } from "../shared/normalization.js";
import { jsonContent } from "../shared/responses.js";
import { lineSchema } from "../shared/schemas.js";

const createSupplierInvoiceService = new DocumentCreationService({
  create: createSupplierInvoice,
  addLine: addSupplierInvoiceLine,
  validate: validateSupplierInvoice,
});

export function registerCreateSupplierInvoice(server: McpServer): void {
  server.registerTool(
    "create_supplier_invoice",
    {
      description: "Create a supplier invoice with lines. Use product_ref for catalog products/services, or description with price and VAT for free-text lines.",
      inputSchema: {
        supplier: z.string().describe("Supplier name or Dolibarr ID"),
        supplier_invoice_ref: z.string().min(1).describe("Supplier's invoice reference/number. Must be unique for this supplier."),
        date: z.string().describe("Invoice date (YYYY-MM-DD)"),
        lines: z.array(lineSchema).min(1),
        validate: z.boolean().default(false).describe("Validate the invoice immediately after creation"),
      },
    },
    async ({ supplier, supplier_invoice_ref, date, lines, validate }) => {
      try {
        const result = await createSupplierInvoiceService.create({
          thirdparty: supplier,
          refSupplier: supplier_invoice_ref,
          date,
          lines,
          validate,
        });
        return jsonContent(
          "success" in result
            ? {
                success: true,
                invoice_id: dolibarrId(result.id),
                supplier: result.thirdparty,
                supplier_invoice_ref,
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
