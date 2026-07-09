import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchThirdparties } from "../../dolibarr/thirdparties.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeThirdpartySummary } from "../shared/serializers.js";

export function registerSearchThirdparties(server: McpServer): void {
  registerJsonTool(
    server,
    "search_thirdparties",
    {
      description: "Search Dolibarr third parties only, with an optional filter for clients or suppliers.",
      pretty: true,
      inputSchema: {
        query: z.string().describe("Third party name to search for"),
        kind: z.enum(["all", "clients", "suppliers"])
          .default("all")
          .describe("Limit results to all third parties, clients, or suppliers"),
      },
    },
    async ({ query, kind }) => {
      const thirdparties = await searchThirdparties(query, kind);
      return thirdparties.map(serializeThirdpartySummary);
    },
  );
}
