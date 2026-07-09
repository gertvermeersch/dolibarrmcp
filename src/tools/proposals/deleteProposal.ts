import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteProposal, getProposal, setProposalDraft } from "../../dolibarr/proposals.js";
import { proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import {
  deleteDryRun,
  deletesDisabledResponse,
  mustReopenResponse,
  statusCode,
} from "../shared/deleteGuards.js";

export function registerDeleteProposal(server: McpServer): void {
  registerJsonTool(
    server,
    "delete_proposal",
    {
      description: "Delete a proposal by numeric Dolibarr ID only. Requires confirm:true and MCP_ALLOW_DELETES=true.",
      inputSchema: {
        proposal_id: z.number().int().positive().describe("Dolibarr proposal ID"),
        confirm: z.boolean().default(false).describe("Must be true to delete. Omit for a dry run."),
        reopen_if_closed: z.boolean().default(false).describe("Reopen non-draft proposals before deleting."),
      },
    },
    async ({ proposal_id, confirm, reopen_if_closed }) => {
      const disabled = deletesDisabledResponse();
      if (disabled) return disabled;

      const proposal = await getProposal(proposal_id);
      const status = proposalStatusLabel(proposal.statut);

      if (!confirm) {
        return deleteDryRun({
          entity_type: "proposal",
          id: proposal_id,
          ref: proposal.ref,
          status,
        });
      }

      if (statusCode(proposal.statut) !== 0) {
        if (!reopen_if_closed) {
          return mustReopenResponse("Proposal", proposal.ref, "reopen_if_closed");
        }

        await setProposalDraft(proposal_id);
      }

      await deleteProposal(proposal_id);

      return {
        success: true,
        deleted: true,
        proposal_id,
      };
    },
  );
}
