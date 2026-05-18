import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSearchAcross(server: McpServer): void {
  server.tool(
    "search_across",
    "Fuzzy search across thirdparties, invoices, and orders simultaneously.",
    { query: z.string().describe("Search term") },
    async (_args) => {
      // TODO: implement
      return { content: [{ type: "text", text: "Not yet implemented" }] };
    },
  );
}
