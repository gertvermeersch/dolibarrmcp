import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateProposal, closeProposal } from "../../dolibarr/proposals.js";
import { toApiError } from "../../dolibarr/client.js";
import { jsonContent } from "../shared/responses.js";

export function registerSetProposalStatus(server: McpServer): void {
  server.registerTool(
    "set_proposal_status",
    {
      description: "Mark a proposal as accepted or refused. Handles Dolibarr's validate→close flow internally.",
      inputSchema: {
        proposal_id: z.number().int().describe("Dolibarr proposal ID"),
        status: z.enum(["accepted", "refused"]),
        note: z.string().optional().describe("Optional private note to attach to the status change"),
        note_private: z.string().optional().describe("Optional mention to add at the end of the private note"),
        note_public: z.string().optional().describe("Optional mention to add at the end of the public note"),
        notrigger: z.number().int().optional().describe("Set to 1 to disable Dolibarr triggers"),
      },
    },
    async ({ proposal_id, status, note, note_private, note_public, notrigger }) => {
      try {
        // Dolibarr requires a proposal to be validated before it can be closed
        await validateProposal(proposal_id).catch(() => {
          // Already validated — safe to ignore
        });

        await closeProposal(proposal_id, status, {
          note_private: note_private ?? note,
          note_public,
          notrigger,
        });

        return jsonContent({
          success: true,
          proposal_id,
          status,
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
