import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { catalogUpdateFieldsSchema, updateCatalogItem } from "./catalogUpdate.js";

export function registerUpdateService(server: McpServer): void {
  registerJsonTool(
    server,
    "update_service",
    {
      description: "Update a catalog service: ref, label, description, selling price, VAT rate, on sale / on purchase, notes. Only the fields you pass change. Use update_product for products.",
      inputSchema: {
        service: z.string().describe("Exact service reference or Dolibarr ID"),
        ...catalogUpdateFieldsSchema,
      },
      errorContext: ({ ref }) => ({ productRef: ref }),
    },
    async ({ service, ...changes }) => updateCatalogItem("service", { item: service, ...changes }),
  );
}
