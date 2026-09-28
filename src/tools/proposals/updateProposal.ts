import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addProposalLine,
  deleteProposalLine,
  getProposal,
  listProposals,
  proposalValidityDaysForUpdate,
  updateProposal,
  updateProposalLine,
} from "../../dolibarr/proposals.js";
import { proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { DocumentUpdateService } from "../../dolibarr/documents/documentUpdateService.js";
import { documentUpdateResponse } from "../shared/documentUpdateResponse.js";
import { isoDateFromTimestamp } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import { documentLineEditsSchema } from "../shared/schemas.js";

const updateProposalService = new DocumentUpdateService(
  {
    get: getProposal,
    updateHeader: updateProposal,
    addLine: addProposalLine,
    updateLine: updateProposalLine,
    deleteLine: deleteProposalLine,
  },
  {
    entityLabel: "Proposal",
    reopenTool: "set_proposal_status (status: draft)",
    headerFields: {
      date: "date",
      valid_until: "fin_validite",
      customer_ref: "ref_client",
      note_public: "note_public",
      note_private: "note_private",
    },
    dateFields: ["date", "valid_until"],
    validateHeader: (fields, current) => {
      const days = proposalValidityDaysForUpdate(fields, current);
      return days !== undefined && days < 0
        ? "valid_until must be on or after the proposal date."
        : undefined;
    },
  },
);

export function registerUpdateProposal(server: McpServer): void {
  registerJsonTool(
    server,
    "update_proposal",
    {
      description: "Update a draft proposal/quote: header fields, validity date, and line edits in one call. Only draft proposals can be updated; validation and acceptance/refusal use their own tools.",
      inputSchema: {
        proposal: z.string().describe("Proposal reference (e.g. (PROV42)) or Dolibarr ID"),
        date: z.string().optional().describe("Proposal date (YYYY-MM-DD). Without valid_until, the validity period is kept and the end date moves with it."),
        valid_until: z.string().optional().describe("End of validity date (YYYY-MM-DD)"),
        customer_ref: z.string().optional().describe("Client's own reference"),
        note_public: z.string().optional(),
        note_private: z.string().optional(),
        ...documentLineEditsSchema,
      },
    },
    async ({ proposal: proposalInput, update_lines, add_lines, remove_line_ids, ...header }) => {
      const proposal = await resolveByIdOrRef(proposalInput, { getById: getProposal, list: listProposals });
      if (!proposal) {
        return {
          error: "PROPOSAL_NOT_FOUND",
          message: `No proposal found for '${proposalInput}'.`,
        };
      }

      const result = await updateProposalService.update(proposal, {
        header,
        updateLines: update_lines,
        addLines: add_lines,
        removeLineIds: remove_line_ids,
      });

      return documentUpdateResponse(result, {
        idKey: "proposal_id",
        statusLabel: (updated) => proposalStatusLabel(updated.statut),
        extra: (updated) => ({
          date: isoDateFromTimestamp(updated.date),
          valid_until: isoDateFromTimestamp(updated.fin_validite),
        }),
      });
    },
  );
}
