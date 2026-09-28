import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { catalogUpdateFieldsSchema, updateCatalogItem } from "./catalogUpdate.js";

export function registerUpdateProduct(server: McpServer): void {
  registerJsonTool(
    server,
    "update_product",
    {
      description: "Update a catalog product: ref, label, description, selling price, VAT rate, on sale / on purchase, notes. Only the fields you pass change. Use update_service for services.",
      inputSchema: {
        product: z.string().describe("Exact product reference or Dolibarr ID"),
        ...catalogUpdateFieldsSchema,
      },
      errorContext: ({ ref }) => ({ productRef: ref }),
    },
    async ({ product, ...changes }) => updateCatalogItem("product", { item: product, ...changes }),
  );
}
