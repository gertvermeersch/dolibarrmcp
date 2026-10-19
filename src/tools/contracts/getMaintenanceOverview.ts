import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isDolibarrNotFoundError } from "../../dolibarr/errors.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import {
  annualValueExclTax,
  daysBetweenIso,
  interventionDurationHours,
  todayIso,
} from "../../dolibarr/maintenance/contractRules.js";
import {
  loadMaintenanceOverview,
  maintenanceLookbackMonths,
} from "../../dolibarr/maintenance/contractReadService.js";
import { cleanString, compactObject, dolibarrId } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { interventionsUnavailableWarning, serializeContractServices } from "../shared/maintenanceSerializers.js";

export function registerGetMaintenanceOverview(server: McpServer): void {
  registerJsonTool(
    server,
    "get_maintenance_overview",
    {
      description: `Maintenance overview of one client: its contracts with running services and, per contract, the latest done intervention. A contract with no done intervention in the last ${maintenanceLookbackMonths} months is flagged with no_maintenance_last_12_months. Contracts without running services (draft or closed) are only counted.`,
      annotations: { readOnlyHint: true },
      pretty: true,
      inputSchema: { thirdparty_id: z.number().int().positive().describe("Dolibarr thirdparty ID") },
    },
    async ({ thirdparty_id }) => {
      let client;
      try {
        client = await getThirdparty(thirdparty_id);
      } catch (err) {
        if (!isDolibarrNotFoundError(err)) throw err;
        return {
          error: "THIRDPARTY_NOT_FOUND",
          message: `No thirdparty found with ID ${thirdparty_id}.`,
          action: "Use search_thirdparties to find the thirdparty ID.",
        };
      }

      const today = todayIso();
      const overview = await loadMaintenanceOverview(thirdparty_id, today);
      const flagged = overview.contracts.filter((entry) => entry.noMaintenanceInLookback === true);

      return {
        as_of: today,
        client: { id: dolibarrId(client.id), name: cleanString(client.name) },
        lookback_from: overview.lookbackFrom,
        contracts: overview.contracts.map((entry) => compactObject({
          id: dolibarrId(entry.contract.id),
          ref: entry.contract.ref,
          services: serializeContractServices(entry.contract.lines),
          end_date: entry.endDate,
          days_until_end: entry.endDate ? daysBetweenIso(today, entry.endDate) : undefined,
          status: entry.status,
          annual_value_excluding_tax: annualValueExclTax(entry.contract.lines),
          last_done_intervention: entry.lastDone
            ? compactObject({
              id: dolibarrId(entry.lastDone.id),
              ref: entry.lastDone.ref,
              date: entry.lastDoneDate,
              duration_hours: interventionDurationHours(entry.lastDone),
              description: cleanString(entry.lastDone.description),
            })
            : undefined,
          no_maintenance_last_12_months: entry.noMaintenanceInLookback,
        })),
        contracts_without_recent_maintenance: flagged.map((entry) => entry.contract.ref),
        inactive_contracts: overview.inactiveContractCount,
        ...(overview.interventionsAvailable
          ? {}
          : { interventions_available: false, warning: interventionsUnavailableWarning }),
      };
    },
  );
}
