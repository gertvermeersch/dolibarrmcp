import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetOutstandingReceivables(server: McpServer): void {
  server.registerTool(
    "get_outstanding_receivables",
    {
      description: "Get all unpaid client invoices grouped by client, with aging buckets (0-30, 30-60, 60-90, 90+ days).",
      inputSchema: {},
    },
    async () => {
      // TODO: implement
      return { content: [{ type: "text", text: "Not yet implemented" }] };
    },
  );
}
