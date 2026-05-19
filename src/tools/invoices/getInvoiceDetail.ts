import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetInvoiceDetail(server: McpServer): void {
  server.tool(
    "get_invoice_detail",
    "Get full details of a client invoice: resolved labels, line items, client info, and payment status.",
    { invoice: z.string().describe("Invoice reference (e.g. FA2024-0042) or Dolibarr ID") },
    async (_args) => {
      // TODO: implement
      return { content: [{ type: "text", text: "Not yet implemented" }] };
    },
  );
}
