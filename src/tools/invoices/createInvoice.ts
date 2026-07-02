import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createInvoice, addInvoiceLine, validateInvoice } from "../../dolibarr/invoices.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { toApiError } from "../../dolibarr/client.js";
import { dolibarrId } from "../shared/normalization.js";
import { jsonContent } from "../shared/responses.js";
import { lineSchema } from "../shared/schemas.js";

const createInvoiceService = new DocumentCreationService({
  create: createInvoice,
  addLine: addInvoiceLine,
  validate: validateInvoice,
});

export function registerCreateInvoice(server: McpServer): void {
  server.registerTool(
    "create_invoice",
    {
      description: "Create a client invoice with lines. Use product_ref for catalog products/services, or description with price and VAT for free-text lines.",
      inputSchema: {
        client: z.string().describe("Client name or Dolibarr ID"),
        date: z.string().describe("Invoice date (YYYY-MM-DD)"),
        lines: z.array(lineSchema).min(1),
        validate: z.boolean().default(false).describe("Validate (confirm) the invoice immediately after creation"),
      },
    },
    async ({ client, date, lines, validate }) => {
      try {
        const result = await createInvoiceService.create({
          thirdparty: client,
          date,
          lines,
          validate,
        });
        return jsonContent(
          "success" in result
            ? {
                success: true,
                invoice_id: dolibarrId(result.id),
                client: result.thirdparty,
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
