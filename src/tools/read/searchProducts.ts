import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchProducts } from "../../dolibarr/products.js";
import { toApiError } from "../../dolibarr/client.js";

export function registerSearchProducts(server: McpServer): void {
  server.tool(
    "search_products",
    "Search the Dolibarr product/service catalog by reference or label.",
    { query: z.string().describe("Product ref or label to search for") },
    async ({ query }) => {
      try {
        const products = await searchProducts(query);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              products.map((p) => ({
                id: p.id,
                ref: p.ref,
                label: p.label,
                price: p.price,
                vat_rate: p.tva_tx,
                type: p.type === 1 ? "service" : "product",
              })),
              null,
              2,
            ),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify(toApiError(err)) }] };
      }
    },
  );
}
