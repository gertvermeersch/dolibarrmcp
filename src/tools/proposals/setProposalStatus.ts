import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { closeProposal, getProposal, setProposalDraft, validateProposal } from "../../dolibarr/proposals.js";
import { DolibarrApiError, toApiError } from "../../dolibarr/client.js";
import { jsonContent } from "../shared/responses.js";
import { statusCode } from "../shared/deleteGuards.js";

function isAlreadyValidatedProposalError(err: unknown, proposalId: number): boolean {
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/proposals/${proposalId}/validate`
  );
}

function isAlreadyDraftProposalError(err: unknown, proposalId: number): boolean {
  return (
    err instanceof DolibarrApiError &&
    err.status === 304 &&
    err.path === `/proposals/${proposalId}/settodraft`
  );
}

export function registerSetProposalStatus(server: McpServer): void {
  server.registerTool(
    "set_proposal_status",
    {
      description: "Set a proposal status to draft, accepted, or refused. Accepted/refused handles Dolibarr's validate→close flow internally.",
      inputSchema: {
        proposal_id: z.number().int().describe("Dolibarr proposal ID"),
        status: z.enum(["draft", "accepted", "refused"]),
        note: z.string().optional().describe("Optional private note to attach to the status change"),
        note_private: z.string().optional().describe("Optional mention to add at the end of the private note"),
        note_public: z.string().optional().describe("Optional mention to add at the end of the public note"),
        notrigger: z.number().int().optional().describe("Set to 1 to disable Dolibarr triggers"),
      },
    },
    async ({ proposal_id, status, note, note_private, note_public, notrigger }) => {
      try {
        if (status === "draft") {
          const proposal = await getProposal(proposal_id);
          if (statusCode(proposal.statut) === 0) {
            return jsonContent({
              success: true,
              proposal_id,
              status: "draft",
              note: "Already draft.",
            });
          }

          try {
            await setProposalDraft(proposal_id);
          } catch (err) {
            if (!isAlreadyDraftProposalError(err, proposal_id)) throw err;
          }

          return jsonContent({
            success: true,
            proposal_id,
            status: "draft",
          });
        }

        // Dolibarr requires a proposal to be validated before it can be closed
        try {
          await validateProposal(proposal_id, { notrigger });
        } catch (err) {
          if (!isAlreadyValidatedProposalError(err, proposal_id)) throw err;
        }

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
