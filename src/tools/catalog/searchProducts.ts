import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchProducts } from "../../dolibarr/products.js";
import { toApiError } from "../../dolibarr/client.js";
import { dolibarrId, money } from "../shared/normalization.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";

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
        return prettyJsonContent(products.map((p) => ({
          id: dolibarrId(p.id),
          ref: p.ref,
          label: p.label,
          price: money(p.price),
          vat_rate: p.tva_tx,
          type: p.type === 1 ? "service" : "product",
        })));
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
