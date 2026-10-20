import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listOrders } from "../../dolibarr/orders.js";
import { orderStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeClientDocumentSummary } from "../shared/serializers.js";
import { dolibarrId } from "../shared/normalization.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { paginationSchema, thirdpartyFilterSchema, dateRangeSchema, dateRangeError, dateFilters, listWindow, listResponse } from "../shared/listing.js";

const statuses = { cancelled: -1, canceled: -1, draft: 0, validated: 1, shipment_in_process: 2, delivered: 3 };

export function registerListOrders(server: McpServer): void {
  registerJsonTool(server, "list_orders", {
    description: "List customer orders with customer, status and inclusive document-date filters.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      ...thirdpartyFilterSchema, ...dateRangeSchema, ...paginationSchema,
      status: z.enum(["cancelled", "canceled", "draft", "validated", "shipment_in_process", "delivered"]).optional(),
    },
  }, async (args) => {
    const error = dateRangeError(args);
    if (error) return error;
    const filters = dateFilters("t.date_commande", args);
    if (args.status) filters.push(`(t.fk_statut:=:${statuses[args.status]})`);
    const { rows, hasMore } = await listWindow(listOrders, {
      withLines: "false",
      ...(args.thirdparty_id !== undefined ? { thirdparty_ids: String(args.thirdparty_id) } : {}),
      ...(filters.length ? { sqlfilters: filters.join(" AND ") } : {}),
    }, args.limit, args.offset);
    const names = await resolveMissingThirdpartyNames(rows.map((row) => dolibarrId(row.socid)));
    return listResponse("orders", rows.map((row) => ({
      ...serializeClientDocumentSummary(row, orderStatusLabel(row.statut ?? row.status) ?? "unknown", names),
      thirdparty_id: dolibarrId(row.socid),
    })), args.limit, args.offset, hasMore);
  });
}
