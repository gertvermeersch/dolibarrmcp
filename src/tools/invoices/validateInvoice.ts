import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateInvoice } from "../../dolibarr/invoices.js";
import { toApiError } from "../../dolibarr/errors.js";
import { jsonContent } from "../shared/responses.js";

export function registerValidateInvoice(server: McpServer): void {
  server.registerTool(
    "validate_invoice",
    {
      description: "Validate a draft client invoice so it becomes confirmed.",
      inputSchema: {
        invoice_id: z.number().int().describe("Dolibarr invoice ID"),
        notrigger: z.number().int().optional().describe("Set to 1 to disable Dolibarr triggers"),
      },
    },
    async ({ invoice_id, notrigger }) => {
      try {
        await validateInvoice(invoice_id, { notrigger });

        return jsonContent({
          success: true,
          invoice_id,
          status: "validated",
        });
      } catch (err) {
        const result = toApiError(err);
        return jsonContent(
          "success" in result
            ? { ...result, invoice_id }
            : result,
        );
      }
    },
  );
}
