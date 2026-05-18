import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateProposal, closeProposal } from "../../dolibarr/proposals.js";
import { toApiError } from "../../dolibarr/client.js";

export function registerSetProposalStatus(server: McpServer): void {
  server.tool(
    "set_proposal_status",
    "Mark a proposal as accepted or refused. Handles Dolibarr's validate→close flow internally.",
    {
      proposal_id: z.number().int().describe("Dolibarr proposal ID"),
      status: z.enum(["accepted", "refused"]),
      note: z.string().optional().describe("Optional note to attach to the status change"),
    },
    async ({ proposal_id, status, note }) => {
      try {
        // Dolibarr requires a proposal to be validated before it can be closed
        await validateProposal(proposal_id).catch(() => {
          // Already validated — safe to ignore
        });

        await closeProposal(proposal_id, status, note);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              proposal_id,
              status,
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify(toApiError(err)) }] };
      }
    },
  );
}
