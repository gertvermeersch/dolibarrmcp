import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProposal, listProposals } from "../../dolibarr/proposals.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { jsonContent } from "../shared/responses.js";
import type { DolibarrProposal } from "../../types/dolibarr.js";

const proposalStatus: Record<number, string> = {
  0: "draft",
  1: "validated",
  2: "accepted",
  3: "refused",
  4: "billed",
};

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
          id: proposal.id,
          ref: proposal.ref,
          status: proposalStatus[Number(proposal.statut)] ?? String(proposal.statut),
          dates: {
            proposal: proposal.date,
            valid_until: proposal.date_fin_validite,
          },
          totals: {
            total_ht: proposal.total_ht,
            total_tva: rawProposal.total_tva,
            total_ttc: proposal.total_ttc,
          },
          client: {
            id: client.id,
            name: client.name,
            code_client: client.code_client,
            email: client.email,
            phone: client.phone,
            address: client.address,
            zip: client.zip,
            town: client.town,
            vat_number: client.tva_intra,
          },
          lines: (proposal.lines ?? []).map((line) => ({
            id: line.id,
            product_id: line.fk_product,
            product_ref: line.product_ref,
            label: line.product_label ?? line.desc,
            description: line.desc,
            qty: line.qty,
            unit_price: line.subprice,
            vat_rate: line.tva_tx,
            total_ht: line.total_ht,
            total_ttc: line.total_ttc,
          })),
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
