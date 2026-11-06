import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createInvoice, addInvoiceLine, validateInvoice } from "../../dolibarr/invoices.js";
import { getProposal, listProposals } from "../../dolibarr/proposals.js";
import { linkedObjectIds } from "../../dolibarr/maintenance/contractRules.js";
import { INVOICE_TYPE_CODES } from "../../dolibarr/statusLabels.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import { dolibarrId } from "../shared/normalization.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { documentCreationResponse } from "../shared/documentCreationResponse.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { lineSchema } from "../shared/schemas.js";

const createInvoiceService = new DocumentCreationService({
  create: createInvoice,
  addLine: addInvoiceLine,
  validate: validateInvoice,
});

const invoiceTypes = Object.keys(INVOICE_TYPE_CODES) as [keyof typeof INVOICE_TYPE_CODES, ...Array<keyof typeof INVOICE_TYPE_CODES>];

export function registerCreateInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "create_invoice",
    {
      description: "Create a client invoice with lines. Use product_ref for catalog products/services, or description with price and VAT for free-text lines. Set type to 'deposit' for a deposit invoice (voorschotfactuur / facture d'acompte) and proposal to link the invoice to the proposal it bills.",
      inputSchema: {
        client: z.string().describe("Client name or Dolibarr ID"),
        date: z.string().describe("Invoice date (YYYY-MM-DD)"),
        due_date: z.string().optional().describe("Payment due date (YYYY-MM-DD). Defaults to the date derived from the payment terms."),
        type: z.enum(invoiceTypes).default("standard").describe("Invoice type: 'standard' or 'deposit' (voorschotfactuur / advance payment invoice)"),
        proposal: z.string().optional().describe("Proposal reference (e.g. PR2024-0042) or Dolibarr ID to link the invoice to. Must belong to the same client."),
        lines: z.array(lineSchema).min(1),
        validate: z.boolean().default(false).describe("Validate (confirm) the invoice immediately after creation"),
      },
    },
    async ({ client, date, due_date, type, proposal: proposalInput, lines, validate }) => {
      const proposal = proposalInput
        ? await resolveByIdOrRef(proposalInput, { getById: getProposal, list: listProposals })
        : undefined;

      if (proposalInput && !proposal) {
        return {
          error: "PROPOSAL_NOT_FOUND",
          message: `No proposal found for '${proposalInput}'.`,
          action: "Run list_proposals to find the proposal ref or ID.",
        };
      }

      const result = await createInvoiceService.create({
        thirdparty: client,
        date,
        dueDate: due_date,
        type: INVOICE_TYPE_CODES[type],
        origin: proposal
          ? { element: "propal", id: Number(proposal.id), ref: proposal.ref, socid: Number(proposal.socid) }
          : undefined,
        lines,
        validate,
      });

      if (!("success" in result)) return result;

      // Dolibarr silently ignores unsupported link fields, so confirm on the proposal.
      const linked = proposal ? await proposalLinksInvoice(Number(proposal.id), result.id) : undefined;

      return documentCreationResponse(result, {
        idKey: "invoice_id",
        thirdpartyKey: "client",
        extra: {
          type,
          ...(proposal ? {
            proposal: { id: dolibarrId(proposal.id), ref: proposal.ref },
            linked_to_proposal: linked,
            ...(linked ? {} : {
              warning: "The invoice was created but Dolibarr did not confirm the link to the proposal. Check it with get_proposal_detail.",
            }),
          } : {}),
        },
      });
    },
  );
}

async function proposalLinksInvoice(proposalId: number, invoiceId: number): Promise<boolean> {
  const refreshed = await getProposal(proposalId);
  return linkedObjectIds(refreshed.linkedObjectsIds, "facture").includes(invoiceId);
}
