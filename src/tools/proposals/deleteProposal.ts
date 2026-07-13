import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteProposal, getProposal, setProposalDraft } from "../../dolibarr/proposals.js";
import { proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { runGuardedDelete } from "../shared/deleteGuards.js";

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
    async ({ proposal_id, confirm, reopen_if_closed }) =>
      runGuardedDelete({
        entityType: "proposal",
        entityLabel: "Proposal",
        idKey: "proposal_id",
        reopenFlag: "reopen_if_closed",
        id: proposal_id,
        confirm,
        reopen: reopen_if_closed,
        fetch: getProposal,
        statusLabel: (proposal) => proposalStatusLabel(proposal.statut),
        reopenToDraft: setProposalDraft,
        remove: deleteProposal,
      }),
  );
}
