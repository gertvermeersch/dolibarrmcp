import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProposal, listProposals } from "../../dolibarr/proposals.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import { dolibarrId, isoDateFromTimestamp, money } from "../shared/normalization.js";
import { serializeLineItem, serializeThirdpartyIdentity } from "../shared/serializers.js";
import type { DolibarrProposal } from "../../types/dolibarr.js";

function resolveProposal(value: string): Promise<DolibarrProposal | undefined> {
  return resolveByIdOrRef(value, { getById: getProposal, list: listProposals });
}

export function registerGetProposalDetail(server: McpServer): void {
  registerJsonTool(
    server,
    "get_proposal_detail",
    {
      description: "Get full details of a proposal/quote: resolved labels, line items, client info, validity date, and status.",
      inputSchema: { proposal: z.string().describe("Proposal reference (e.g. PR2024-0042) or Dolibarr ID") },
    },
    async ({ proposal: proposalInput }) => {
      const proposal = await resolveProposal(proposalInput);

      if (!proposal) {
        return {
          error: "PROPOSAL_NOT_FOUND",
          message: `No proposal found for '${proposalInput}'.`,
        };
      }

      const client = await getThirdparty(Number(proposal.socid));
      const rawProposal = proposal as DolibarrProposal & Record<string, unknown>;

      return {
        id: dolibarrId(proposal.id),
        ref: proposal.ref,
        status: proposalStatusLabel(proposal.statut),
        dates: {
          proposal: isoDateFromTimestamp(proposal.date),
          valid_until: isoDateFromTimestamp(proposal.date_fin_validite),
        },
        totals: {
          total_excluding_tax: money(proposal.total_ht),
          total_tax: money(rawProposal.total_tva),
          total_including_tax: money(proposal.total_ttc),
        },
        client: serializeThirdpartyIdentity(client),
        lines: (proposal.lines ?? []).map(serializeLineItem),
      };
    },
  );
}
