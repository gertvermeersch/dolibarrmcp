import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listProposals } from "../../dolibarr/proposals.js";
import { proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeProposalSearchSummary } from "../shared/serializers.js";
import { dolibarrId } from "../shared/normalization.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { paginationSchema, thirdpartyFilterSchema, dateRangeSchema, dateRangeError, dateFilters, listWindow, listResponse } from "../shared/listing.js";

const statuses = { draft: 0, validated: 1, sent: 1, accepted: 2, refused: 3, billed: 4 };

export function registerListProposals(server: McpServer): void {
  registerJsonTool(server, "list_proposals", {
    description: "List customer proposals with customer, status and inclusive document-date filters. sent is an alias for validated (Dolibarr has no sent status); closed includes accepted, refused and billed.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: {
      ...thirdpartyFilterSchema, ...dateRangeSchema, ...paginationSchema,
      status: z.enum(["draft", "validated", "sent", "accepted", "refused", "billed", "closed"]).optional(),
    },
  }, async (args) => {
    const error = dateRangeError(args);
    if (error) return error;
    const filters = dateFilters("t.datep", args);
    if (args.status) filters.push(args.status === "closed" ? "(t.fk_statut:in:2,3,4)" : `(t.fk_statut:=:${statuses[args.status]})`);
    const { rows, hasMore } = await listWindow(listProposals, {
      withLines: "false",
      ...(args.thirdparty_id !== undefined ? { thirdparty_ids: String(args.thirdparty_id) } : {}),
      ...(filters.length ? { sqlfilters: filters.join(" AND ") } : {}),
    }, args.limit, args.offset);
    const names = await resolveMissingThirdpartyNames(rows.map((row) => dolibarrId(row.socid)));
    return listResponse("proposals", rows.map((row) => ({
      ...serializeProposalSearchSummary(row, proposalStatusLabel(row.statut) ?? "unknown", names),
      thirdparty_id: dolibarrId(row.socid),
    })), args.limit, args.offset, hasMore);
  });
}
