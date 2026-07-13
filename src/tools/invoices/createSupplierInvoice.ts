import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSupplierInvoice, addSupplierInvoiceLine, validateSupplierInvoice } from "../../dolibarr/supplierInvoices.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { documentCreationResponse } from "../shared/documentCreationResponse.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { lineSchema } from "../shared/schemas.js";

const createSupplierInvoiceService = new DocumentCreationService({
  create: createSupplierInvoice,
  addLine: addSupplierInvoiceLine,
  validate: validateSupplierInvoice,
});

export function registerCreateSupplierInvoice(server: McpServer): void {
  registerJsonTool(
    server,
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
      errorContext: ({ supplier_invoice_ref }) => ({ supplierInvoiceRef: supplier_invoice_ref }),
    },
    async ({ supplier, supplier_invoice_ref, date, lines, validate }) => {
      const result = await createSupplierInvoiceService.create({
        thirdparty: supplier,
        refSupplier: supplier_invoice_ref,
        date,
        lines,
        validate,
      });
      return documentCreationResponse(result, {
        idKey: "invoice_id",
        thirdpartyKey: "supplier",
        extra: { supplier_invoice_ref },
      });
    },
  );
}
