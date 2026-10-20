import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readPayments } from "../../dolibarr/documents/paymentReadService.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { dateRangeSchema, paginationSchema, thirdpartyFilterSchema } from "../shared/listing.js";

export function registerListPayments(server: McpServer): void {
  registerJsonTool(server, "list_payments", {
    description: "Audit customer invoice payment allocations by thirdparty and inclusive payment dates. A shared payment appears once per invoice, with its allocated amount. Scans invoices of all dates, newest ID first, then sorts allocations by payment date descending. Check scan.complete and scan.more_invoices_available; continue with scan.next_invoice_offset and reset offset to 0 for the next scan. limit/offset paginate allocations within the current scan. Excludes supplier payments, credit notes, discounts and deposit applications.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      ...thirdpartyFilterSchema, ...dateRangeSchema, ...paginationSchema,
      max_invoices: z.number().int().min(1).max(10000).default(1000).describe("Maximum invoices inspected per scan"),
      invoice_offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 10001).default(0).describe("Resume an incomplete invoice scan here"),
    },
  }, readPayments);
}
