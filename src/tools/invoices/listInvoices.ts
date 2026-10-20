import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listInvoices } from "../../dolibarr/invoices.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeInvoiceSearchSummary } from "../shared/serializers.js";
import { dolibarrId } from "../shared/normalization.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { paginationSchema, thirdpartyFilterSchema, dateRangeSchema, dateRangeError, dateFilters, listWindow, listResponse } from "../shared/listing.js";

const statuses = { draft: 0, validated: 1, paid: 2, cancelled: 3 };

export function registerListInvoices(server: McpServer): void {
  registerJsonTool(server, "list_invoices", {
    description: "List customer invoices with customer, status and inclusive document-date filters.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      ...thirdpartyFilterSchema, ...dateRangeSchema, ...paginationSchema,
      status: z.enum(["draft", "validated", "paid", "cancelled"]).optional(),
    },
  }, async (args) => {
    const error = dateRangeError(args);
    if (error) return error;
    const filters = dateFilters("t.datef", args);
    if (args.status) filters.push(`(t.fk_statut:=:${statuses[args.status]})`);
    const { rows, hasMore } = await listWindow(listInvoices, {
      withLines: "false",
      ...(args.thirdparty_id !== undefined ? { thirdparty_ids: String(args.thirdparty_id) } : {}),
      ...(filters.length ? { sqlfilters: filters.join(" AND ") } : {}),
    }, args.limit, args.offset);
    const names = await resolveMissingThirdpartyNames(rows.map((row) => dolibarrId(row.socid)));
    return listResponse("invoices", rows.map((row) => ({
      ...serializeInvoiceSearchSummary(row, invoiceStatusLabel(row.statut) ?? "unknown", names),
      thirdparty_id: dolibarrId(row.socid),
    })), args.limit, args.offset, hasMore);
  });
}
