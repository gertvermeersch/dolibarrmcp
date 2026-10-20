import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listContracts } from "../../dolibarr/contracts.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeContractSearchSummary, serializeContractServices } from "../shared/maintenanceSerializers.js";
import { dolibarrId } from "../shared/normalization.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";
import { paginationSchema, thirdpartyFilterSchema, listWindow, listResponse } from "../shared/listing.js";

export function registerListContracts(server: McpServer): void {
  registerJsonTool(server, "list_contracts", {
    description: "Browse all contracts, optionally for a thirdparty, including contracts without an expiry date. Includes current service summaries.",
    annotations: { readOnlyHint: true },
    pretty: true,
    inputSchema: { ...thirdpartyFilterSchema, ...paginationSchema },
  }, async ({ thirdparty_id, limit, offset }) => {
    const { rows, hasMore } = await listWindow(listContracts, {
      withLines: "true",
      ...(thirdparty_id !== undefined ? { thirdparty_ids: String(thirdparty_id) } : {}),
    }, limit, offset);
    const names = await resolveMissingThirdpartyNames(rows.map((row) => dolibarrId(row.socid)));
    return listResponse("contracts", rows.map((row) => ({
      ...serializeContractSearchSummary(row, names),
      thirdparty_id: dolibarrId(row.socid),
      services: serializeContractServices(row.lines),
    })), limit, offset, hasMore);
  });
}
