import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSupplierInvoice, addSupplierInvoiceLine, validateSupplierInvoice } from "../../dolibarr/supplierInvoices.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import { resolveLine } from "../../resolvers/product.js";
import { toApiError } from "../../dolibarr/client.js";

const lineSchema = z.object({
  description: z.string(),
  qty: z.number().positive(),
  unit_price: z.number().optional(),
  vat_rate: z.number().optional(),
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
        const resolved = await resolveThirdparty(supplier);
        if (!resolved.ok) {
          return { content: [{ type: "text", text: JSON.stringify(resolved.error) }] };
        }

        const lineResults = await Promise.all(
          lines.map((l, i) => resolveLine(l, i + 1)),
        );

        const errors = lineResults.filter((r) => !r.ok);
        if (errors.length > 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "VALIDATION_ERROR",
                message: "One or more lines could not be resolved.",
                line_errors: errors.map((e) => (!e.ok ? e.error : null)).filter(Boolean),
              }),
            }],
          };
        }

        const dateTs = Math.floor(new Date(date).getTime() / 1000);
        const invoiceId = await createSupplierInvoice({ socid: resolved.id, date: dateTs });

        const resolvedLines = lineResults.map((r) => (r.ok ? r.resolved : null)).filter(Boolean);
        for (const r of resolvedLines) {
          await addSupplierInvoiceLine(invoiceId, r!.line);
        }

        if (validate) await validateSupplierInvoice(invoiceId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              invoice_id: invoiceId,
              supplier: resolved.name,
              validated: validate,
              lines: resolvedLines.map((r) => r!.resolution),
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify(toApiError(err)) }] };
      }
    },
  );
}
