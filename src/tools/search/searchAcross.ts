import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerSearchAcross(server: McpServer): void {
  server.registerTool(
    "search_across",
    {
      description: "Fuzzy search across thirdparties, invoices, and orders simultaneously.",
      inputSchema: { query: z.string().describe("Search term") },
    },
    async (_args) => {
      // TODO: implement
      return { content: [{ type: "text", text: "Not yet implemented" }] };
    },
  );
}
