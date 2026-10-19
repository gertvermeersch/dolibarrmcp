import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  interventionContractId,
  loadContractRefs,
  queryInterventions,
} from "../../dolibarr/maintenance/contractReadService.js";
import { isIsoDateString } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeIntervention } from "../shared/maintenanceSerializers.js";
import { resolveMissingThirdpartyNames } from "../shared/thirdpartyNames.js";

const statusCodes = { draft: 0, validated: 1, billed: 2, done: 3 } as const;

export function registerListInterventions(server: McpServer): void {
  registerJsonTool(
    server,
    "list_interventions",
    {
      description: "List interventions (maintenance visits), most recent first. Each has ref, client, contract, date, duration in hours and description. Status done means the visit was carried out.",
      annotations: { readOnlyHint: true },
      pretty: true,
      inputSchema: {
        thirdparty_id: z.number().int().positive().optional(),
        contract_id: z.number().int().positive().optional(),
        from: z.string().optional().describe("Only interventions on or after this date (YYYY-MM-DD)"),
        to: z.string().optional().describe("Only interventions on or before this date (YYYY-MM-DD)"),
        status: z.enum(["draft", "validated", "billed", "done"]).optional(),
      },
    },
    async ({ thirdparty_id, contract_id, from, to, status }) => {
      for (const [name, value] of [["from", from], ["to", to]] as const) {
        if (value !== undefined && !isIsoDateString(value)) {
          return { error: "VALIDATION_ERROR", message: `${name} must be a valid YYYY-MM-DD calendar date.` };
        }
      }

      const interventions = await queryInterventions({
        thirdpartyId: thirdparty_id,
        contractId: contract_id,
        from,
        to,
        status: status ? statusCodes[status] : undefined,
      });

      const [clientNames, contractRefs] = await Promise.all([
        resolveMissingThirdpartyNames(interventions.map((intervention) => Number(intervention.socid))),
        loadContractRefs(interventions.flatMap((intervention) => interventionContractId(intervention) ?? [])),
      ]);

      return {
        count: interventions.length,
        interventions: interventions.map((intervention) =>
          serializeIntervention(intervention, { clientNames, contractRefs })),
      };
    },
  );
}
