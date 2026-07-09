import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchServices } from "../../dolibarr/products.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeCatalogItem } from "../shared/serializers.js";

export function registerSearchServices(server: McpServer): void {
  registerJsonTool(
    server,
    "search_services",
    {
      description: "Search the Dolibarr service catalog by reference or label.",
      pretty: true,
      inputSchema: { query: z.string().describe("Service ref or label to search for") },
    },
    async ({ query }) => {
      const services = await searchServices(query);
      return services.map(serializeCatalogItem);
    },
  );
}
