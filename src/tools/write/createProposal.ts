import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProposal, addProposalLine, validateProposal } from "../../dolibarr/proposals.js";
import { resolveThirdparty } from "../../resolvers/thirdparty.js";
import { resolveLine } from "../../resolvers/product.js";
import { toApiError } from "../../dolibarr/client.js";

const lineSchema = z.object({
  description: z.string(),
  qty: z.number().positive(),
  unit_price: z.number().optional(),
  vat_rate: z.number().optional(),
});

export function registerCreateProposal(server: McpServer): void {
  server.tool(
    "create_proposal",
    "Create a proposal (devis/quote) for a client with line items.",
    {
      client: z.string().describe("Client name or Dolibarr ID"),
      date: z.string().describe("Proposal date (YYYY-MM-DD)"),
      lines: z.array(lineSchema).min(1),
      validate: z.boolean().default(false).describe("Validate the proposal immediately (makes it sendable)"),
    },
    async ({ client, date, lines, validate }) => {
      try {
        const resolved = await resolveThirdparty(client);
        if (!resolved.ok) {
          return { content: [{ type: "text", text: JSON.stringify(resolved.error) }] };
        }

        const lineResults = await Promise.all(
          lines.map((l, i) => resolveLine(l, i + 1)),
        );

        const errors = lineResults.filter((r) => !r.ok);
        if (errors.length > 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "VALIDATION_ERROR",
                message: "One or more lines could not be resolved.",
                line_errors: errors.map((e) => (!e.ok ? e.error : null)).filter(Boolean),
              }),
            }],
          };
        }

        const dateTs = Math.floor(new Date(date).getTime() / 1000);
        const proposalId = await createProposal({ socid: resolved.id, date: dateTs });

        const resolvedLines = lineResults.map((r) => (r.ok ? r.resolved : null)).filter(Boolean);
        for (const r of resolvedLines) {
          await addProposalLine(proposalId, r!.line);
        }

        if (validate) await validateProposal(proposalId);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              proposal_id: proposalId,
              client: resolved.name,
              validated: validate,
              lines: resolvedLines.map((r) => r!.resolution),
            }),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify(toApiError(err)) }] };
      }
    },
  );
}
