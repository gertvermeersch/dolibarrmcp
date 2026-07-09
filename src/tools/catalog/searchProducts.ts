import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchProducts } from "../../dolibarr/products.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeCatalogItem } from "../shared/serializers.js";

export function registerSearchProducts(server: McpServer): void {
  registerJsonTool(
    server,
    "search_products",
    {
      description: "Search the Dolibarr product/service catalog by reference or label.",
      pretty: true,
      inputSchema: { query: z.string().describe("Product ref or label to search for") },
    },
    async ({ query }) => {
      const products = await searchProducts(query);
      return products.map(serializeCatalogItem);
    },
  );
}
