import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProducts } from "../../dolibarr/products.js";
import { dolibarrLikeLiteral } from "../../dolibarr/sqlFilters.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeCatalogItem } from "../shared/serializers.js";
import { paginationSchema, listWindow, listResponse } from "../shared/listing.js";

export function registerListProducts(server: McpServer): void {
  registerJsonTool(server, "list_products", {
    description: "Browse the product and service catalog. Optional ref and label filters match contained text; filters combine with AND.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      ...paginationSchema,
      ref: z.string().trim().min(1).optional(),
      label: z.string().trim().min(1).optional(),
      type: z.enum(["product", "service"]).optional(),
    },
  }, async ({ ref, label, type, limit, offset }) => {
    const filters = [
      ...(ref ? [`(t.ref:like:${dolibarrLikeLiteral(ref)})`] : []),
      ...(label ? [`(t.label:like:${dolibarrLikeLiteral(label)})`] : []),
    ];
    const { rows, hasMore } = await listWindow(listProducts, {
      mode: type === "product" ? "1" : type === "service" ? "2" : "0",
      ...(filters.length ? { sqlfilters: filters.join(" AND ") } : {}),
    }, limit, offset);
    return listResponse("products", rows.map(serializeCatalogItem), limit, offset, hasMore);
  });
}
