import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetClientOverview(server: McpServer): void {
  server.registerTool(
    "get_client_overview",
    {
      description: "Get a full overview of a client: thirdparty details, contacts, open invoices, unpaid balance, and last order date.",
      inputSchema: { client: z.string().describe("Client name or Dolibarr ID") },
    },
    async (_args) => {
      // TODO: implement
      return { content: [{ type: "text", text: "Not yet implemented" }] };
    },
  );
}
