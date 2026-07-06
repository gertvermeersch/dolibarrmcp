import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchProducts } from "../../dolibarr/products.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";
import { serializeCatalogItem } from "../shared/serializers.js";

export function registerSearchProducts(server: McpServer): void {
  server.registerTool(
    "search_products",
    {
      description: "Search the Dolibarr product/service catalog by reference or label.",
      inputSchema: { query: z.string().describe("Product ref or label to search for") },
    },
    async ({ query }) => {
      try {
        const products = await searchProducts(query);
        return prettyJsonContent(products.map(serializeCatalogItem));
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
