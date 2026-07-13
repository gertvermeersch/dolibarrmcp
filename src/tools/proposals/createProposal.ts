import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProposal, addProposalLine, validateProposal } from "../../dolibarr/proposals.js";
import { DocumentCreationService } from "../../dolibarr/documents/documentCreationService.js";
import { documentCreationResponse } from "../shared/documentCreationResponse.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { lineSchema } from "../shared/schemas.js";

const createProposalService = new DocumentCreationService({
  create: createProposal,
  addLine: addProposalLine,
  validate: validateProposal,
});

export function registerCreateProposal(server: McpServer): void {
  registerJsonTool(
    server,
    "create_proposal",
    {
      description: "Create a proposal (devis/quote) for a client with line items. Use product_ref for catalog products/services, or description with price and VAT for free-text lines.",
      inputSchema: {
        client: z.string().describe("Client name or Dolibarr ID"),
        date: z.string().describe("Proposal date (YYYY-MM-DD)"),
        lines: z.array(lineSchema).min(1),
        validate: z.boolean().default(false).describe("Validate the proposal immediately (makes it sendable)"),
      },
    },
    async ({ client, date, lines, validate }) => {
      const result = await createProposalService.create({
        thirdparty: client,
        date,
        lines,
        validate,
      });
      return documentCreationResponse(result, { idKey: "proposal_id", thirdpartyKey: "client" });
    },
  );
}
