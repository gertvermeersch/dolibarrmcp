import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { annualValueExclTax, todayIso } from "../../dolibarr/maintenance/contractRules.js";
import { listContractsByExpiry } from "../../dolibarr/maintenance/contractReadService.js";
import { compactObject, dolibarrId } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeContractServices } from "../shared/maintenanceSerializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";

export function registerListContractsByExpiry(server: McpServer): void {
  registerJsonTool(
    server,
    "list_contracts_by_expiry",
    {
      description: "List maintenance contracts that have expired or end within the next days_ahead days, sorted by end date (earliest first). The end date is the latest line end date, since Dolibarr contracts have none of their own. Only contracts with running services are listed. Each entry has the services, end date, days until the end (negative when expired), yearly value excl. VAT, status (expired | expiring | running) and renewal_invoiced (a linked invoice dated more than 30 days after the contract start exists).",
      annotations: { readOnlyHint: true },
      pretty: true,
      inputSchema: {
        days_ahead: z.number().int().min(0).default(60).describe("List contracts ending within this many days from today"),
        include_expired: z.boolean().default(true).describe("Also list contracts whose end date has passed"),
        thirdparty_id: z.number().int().positive().optional().describe("Only contracts of this thirdparty"),
        only_without_renewal: z.boolean().optional().describe("Only contracts that have no renewal invoice yet"),
      },
    },
    async ({ days_ahead, include_expired, thirdparty_id, only_without_renewal }) => {
      const today = todayIso();
      const entries = await listContractsByExpiry({
        daysAhead: days_ahead,
        includeExpired: include_expired,
        thirdpartyId: thirdparty_id,
        onlyWithoutRenewal: only_without_renewal,
        today,
      });

      const clientNames = await resolveMissingThirdpartyNames(
        entries.map((entry) => Number(entry.contract.socid)),
      );

      return {
        as_of: today,
        days_ahead,
        count: entries.length,
        contracts: entries.map((entry) => compactObject({
          id: dolibarrId(entry.contract.id),
          ref: entry.contract.ref,
          client: clientNames.get(Number(entry.contract.socid)),
          client_id: dolibarrId(entry.contract.socid),
          services: serializeContractServices(entry.contract.lines),
          end_date: entry.endDate,
          days_until_end: entry.daysUntilEnd,
          annual_value_excluding_tax: annualValueExclTax(entry.contract.lines),
          status: entry.status,
          renewal_invoiced: entry.renewalInvoiced,
        })),
      };
    },
  );
}
