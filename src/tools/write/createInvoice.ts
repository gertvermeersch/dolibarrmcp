import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createInvoice, addInvoiceLine, validateInvoice } from "../../dolibarr/invoices.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import { resolveLine } from "../../resolvers/product.js";
import { toApiError } from "../../dolibarr/client.js";

const lineSchema = z.object({
  description: z.string(),
  qty: z.number().positive(),
  unit_price: z.number().optional(),
  vat_rate: z.number().optional(),
});

export function registerCreateInvoice(server: McpServer): void {
  server.tool(
    "create_invoice",
    "Create a client invoice with lines. Resolves the client by name and matches line items against the product/service catalog where possible.",
    {
      client: z.string().describe("Client name or Dolibarr ID"),
      date: z.string().describe("Invoice date (YYYY-MM-DD)"),
      lines: z.array(lineSchema).min(1),
      validate: z.boolean().default(false).describe("Validate (confirm) the invoice immediately after creation"),
    },
    async ({ client, date, lines, validate }) => {
      try {
        const resolved = await resolveThirdparty(client);
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
        const invoiceId = await createInvoice({ socid: resolved.id, date: dateTs });

        const resolvedLines = lineResults.map((r) => (r.ok ? r.resolved : null)).filter(Boolean);
        for (const r of resolvedLines) {
          await addInvoiceLine(invoiceId, r!.line);
        }

        if (validate) await validateInvoice(invoiceId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              invoice_id: invoiceId,
              client: resolved.name,
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
