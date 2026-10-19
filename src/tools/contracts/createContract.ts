import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContractCreationService } from "../../dolibarr/maintenance/contractCreationService.js";
import { dolibarrId } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";

const contractCreationService = new ContractCreationService();

export function registerCreateContract(server: McpServer): void {
  registerJsonTool(
    server,
    "create_contract",
    {
      description: "Create a maintenance contract for a client, validate it and activate its service lines. The contract runs from start_date for duration_months (so a 12-month contract starting 2026-01-01 ends 2026-12-31). Services are catalog refs with a quantity and take their price and VAT from the catalog.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        client: z.string().describe("Client name or Dolibarr ID"),
        start_date: z.string().describe("Contract start date (YYYY-MM-DD)"),
        duration_months: z.number().int().min(1).max(120).default(12).describe("Contract length in months"),
        services: z.array(z.object({
          product_ref: z.string().min(1).describe("Existing Dolibarr service reference"),
          qty: z.number().positive().default(1),
        })).min(1),
      },
    },
    async ({ client, start_date, duration_months, services }) => {
      const result = await contractCreationService.create({
        thirdparty: client,
        startDate: start_date,
        months: duration_months,
        services,
      });
      if (!("success" in result)) return result;

      return {
        success: true,
        contract_id: dolibarrId(result.id),
        ref: result.ref,
        client: result.thirdparty,
        start_date: result.startDate,
        end_date: result.endDate,
        duration_months: result.months,
        lines: result.lines,
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      };
    },
  );
}
