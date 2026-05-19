import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchServices } from "../../dolibarr/products.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent, prettyJsonContent } from "../shared/responses.js";

export function registerSearchServices(server: McpServer): void {
  server.tool(
    "search_services",
    "Search the Dolibarr service catalog by reference or label.",
    { query: z.string().describe("Service ref or label to search for") },
    async ({ query }) => {
      try {
        const services = await searchServices(query);
        return prettyJsonContent(services.map((s) => ({
          id: s.id,
          ref: s.ref,
          label: s.label,
          price: s.price,
          vat_rate: s.tva_tx,
          type: "service",
        })));
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
