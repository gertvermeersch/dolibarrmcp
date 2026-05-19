import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetMonthlyRevenue(server: McpServer): void {
  server.tool(
    "get_monthly_revenue",
    "Get validated invoices summed by client for a given month, with totals excl. and incl. tax.",
    {
      year: z.number().int().describe("Year (e.g. 2025)"),
      month: z.number().int().min(1).max(12).describe("Month (1–12)"),
    },
    async (_args) => {
      // TODO: implement
      return { content: [{ type: "text", text: "Not yet implemented" }] };
    },
  );
}
