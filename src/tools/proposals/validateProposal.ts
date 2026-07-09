import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateProposal } from "../../dolibarr/proposals.js";
import { toApiError } from "../../dolibarr/errors.js";
import { jsonContent } from "../shared/responses.js";

export function registerValidateProposal(server: McpServer): void {
  server.registerTool(
    "validate_proposal",
    {
      description: "Validate a draft proposal so it becomes sendable, without accepting or refusing it.",
      inputSchema: {
        proposal_id: z.number().int().describe("Dolibarr proposal ID"),
        notrigger: z.number().int().optional().describe("Set to 1 to disable Dolibarr triggers"),
      },
    },
    async ({ proposal_id, notrigger }) => {
      try {
        await validateProposal(proposal_id, { notrigger });

        return jsonContent({
          success: true,
          proposal_id,
          status: "validated",
        });
      } catch (err) {
        const result = toApiError(err);
        return jsonContent(
          "success" in result
            ? { ...result, proposal_id }
            : result,
        );
      }
    },
  );
}
