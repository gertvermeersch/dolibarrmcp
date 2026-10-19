import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveContract } from "../../resolvers/contract.js";
import { InterventionCreationService } from "../../dolibarr/maintenance/interventionCreationService.js";
import { dolibarrId } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { serializeIntervention } from "../shared/maintenanceSerializers.js";

const interventionCreationService = new InterventionCreationService();

export function registerCreateIntervention(server: McpServer): void {
  registerJsonTool(
    server,
    "create_intervention",
    {
      description: "Record a maintenance intervention (visit) on a contract: creates it for the contract's client, adds one line with the date and duration, validates it and, by default, marks it as done.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        contract: z.string().describe("Contract reference (e.g. CT2501-0003) or Dolibarr ID"),
        date: z.string().describe("Date of the intervention (YYYY-MM-DD)"),
        duration_hours: z.number().positive().max(999).describe("Duration in hours, for example 1.5"),
        description: z.string().min(1).describe("What was done"),
        close: z.boolean().default(true).describe("Mark the intervention as done after validating it. False leaves it validated."),
      },
    },
    async ({ contract: contractInput, date, duration_hours, description, close }) => {
      const resolved = await resolveContract(contractInput);
      if (!resolved.ok) return resolved.error;

      const result = await interventionCreationService.create({
        contract: resolved.contract,
        date,
        durationHours: duration_hours,
        description,
        close,
      });
      if (!("success" in result)) return result;

      return {
        success: true,
        intervention_id: dolibarrId(result.intervention.id),
        contract: result.contract,
        intervention: serializeIntervention(result.intervention, {
          contractRefs: new Map([[result.contract.id, result.contract.ref]]),
        }),
      };
    },
  );
}
