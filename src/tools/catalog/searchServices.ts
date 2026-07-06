import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchServices } from "../../dolibarr/products.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";
import { serializeCatalogItem } from "../shared/serializers.js";

export function registerSearchServices(server: McpServer): void {
  server.registerTool(
    "search_services",
    {
      description: "Search the Dolibarr service catalog by reference or label.",
      inputSchema: { query: z.string().describe("Service ref or label to search for") },
    },
    async ({ query }) => {
      try {
        const services = await searchServices(query);
        return prettyJsonContent(services.map(serializeCatalogItem));
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
