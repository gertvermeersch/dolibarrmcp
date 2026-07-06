import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchThirdparties } from "../../dolibarr/thirdparties.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";
import { serializeThirdpartySummary } from "../shared/serializers.js";

export function registerSearchThirdparties(server: McpServer): void {
  server.registerTool(
    "search_thirdparties",
    {
      description: "Search Dolibarr third parties only, with an optional filter for clients or suppliers.",
      inputSchema: {
        query: z.string().describe("Third party name to search for"),
        kind: z.enum(["all", "clients", "suppliers"])
          .default("all")
          .describe("Limit results to all third parties, clients, or suppliers"),
      },
    },
    async ({ query, kind }) => {
      try {
        const thirdparties = await searchThirdparties(query, kind);

        return prettyJsonContent(thirdparties.map(serializeThirdpartySummary));
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
