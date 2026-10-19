import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveContract } from "../../resolvers/contract.js";
import { ContractStatusService } from "../../dolibarr/maintenance/contractStatusService.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";

const contractStatusService = new ContractStatusService();

export function registerSetContractStatus(server: McpServer): void {
  registerJsonTool(
    server,
    "set_contract_status",
    {
      description: "Close a contract (closes all its service lines) or deactivate individual service lines. Nothing is deleted: the contract and its lines stay in Dolibarr, and Dolibarr treats a deactivated line as a closed service. Idempotent: already closed contracts and lines are reported, not changed.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        contract: z.string().describe("Contract reference (e.g. CT2501-0003) or Dolibarr ID"),
        status: z.enum(["closed", "lines_deactivated"]).describe("closed: close the whole contract. lines_deactivated: deactivate the lines in line_ids, or all open lines when line_ids is omitted."),
        line_ids: z.array(z.number().int().positive()).optional().describe("Line IDs to deactivate (lines_deactivated only), as returned by get_contract_detail"),
        date: z.string().optional().describe("Deactivation date (YYYY-MM-DD, lines_deactivated only). Defaults to today."),
        comment: z.string().optional().describe("Comment stored with the deactivation (lines_deactivated only)"),
      },
    },
    async ({ contract: contractInput, status, line_ids, date, comment }) => {
      const resolved = await resolveContract(contractInput);
      if (!resolved.ok) return resolved.error;

      const result = await contractStatusService.set(
        resolved.contract,
        status === "closed"
          ? { status }
          : { status, lineIds: line_ids, date, comment },
      );
      if (!("success" in result)) return result;

      return {
        success: true,
        contract: result.contract,
        status: result.status,
        open_lines: result.openLineCount,
        closed_line_ids: result.closedLineIds,
        ...(result.skippedLineIds.length > 0 ? { skipped_line_ids: result.skippedLineIds } : {}),
        ...(result.note ? { note: result.note } : {}),
      };
    },
  );
}
