import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProposal, listProposals } from "../../dolibarr/proposals.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { proposalStatusLabel } from "../../dolibarr/statusLabels.js";
import { jsonContent } from "../shared/responses.js";
import { dolibarrId, isoDateFromTimestamp, money } from "../shared/normalization.js";
import { serializeLineItem, serializeThirdpartyIdentity } from "../shared/serializers.js";
import type { DolibarrProposal } from "../../types/dolibarr.js";

async function resolveProposal(value: string): Promise<DolibarrProposal | undefined> {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    try {
      return await getProposal(Number(trimmed));
    } catch (err) {
      if (isDolibarrNotFoundError(err)) return undefined;
      throw err;
    }
  }

  const proposals = await listProposals(dolibarrQueryString({
    sqlfilters: `(t.ref:=:${dolibarrStringLiteral(trimmed)})`,
    limit: "1",
  }));

  return proposals[0] ? getProposal(Number(proposals[0].id)) : undefined;
}

export function registerGetProposalDetail(server: McpServer): void {
  server.registerTool(
    "get_proposal_detail",
    {
      description: "Get full details of a proposal/quote: resolved labels, line items, client info, validity date, and status.",
      inputSchema: { proposal: z.string().describe("Proposal reference (e.g. PR2024-0042) or Dolibarr ID") },
    },
    async ({ proposal: proposalInput }) => {
      try {
        const proposal = await resolveProposal(proposalInput);

        if (!proposal) {
          return jsonContent({
            error: "PROPOSAL_NOT_FOUND",
            message: `No proposal found for '${proposalInput}'.`,
          });
        }

        const client = await getThirdparty(Number(proposal.socid));
        const rawProposal = proposal as DolibarrProposal & Record<string, unknown>;

        return jsonContent({
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
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
