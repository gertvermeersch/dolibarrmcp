import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createInvoice, addInvoiceLine, validateInvoice } from "../../dolibarr/invoices.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { documentCreationResponse } from "../shared/documentCreationResponse.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { lineSchema } from "../shared/schemas.js";

const createInvoiceService = new DocumentCreationService({
  create: createInvoice,
  addLine: addInvoiceLine,
  validate: validateInvoice,
});

export function registerCreateInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "create_invoice",
    {
      description: "Create a client invoice with lines. Use product_ref for catalog products/services, or description with price and VAT for free-text lines.",
      inputSchema: {
        client: z.string().describe("Client name or Dolibarr ID"),
        date: z.string().describe("Invoice date (YYYY-MM-DD)"),
        due_date: z.string().optional().describe("Payment due date (YYYY-MM-DD). Defaults to the date derived from the payment terms."),
        lines: z.array(lineSchema).min(1),
        validate: z.boolean().default(false).describe("Validate (confirm) the invoice immediately after creation"),
      },
    },
    async ({ client, date, due_date, lines, validate }) => {
      const result = await createInvoiceService.create({
        thirdparty: client,
        date,
        dueDate: due_date,
        lines,
        validate,
      });
      return documentCreationResponse(result, { idKey: "invoice_id", thirdpartyKey: "client" });
    },
  );
}
