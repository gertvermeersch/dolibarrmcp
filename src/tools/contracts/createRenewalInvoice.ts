import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveContract } from "../../resolvers/contract.js";
import { RenewalInvoiceService } from "../../dolibarr/maintenance/renewalInvoiceService.js";
import { dolibarrId } from "../shared/normalization.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";

const renewalInvoiceService = new RenewalInvoiceService();

export function registerCreateRenewalInvoice(server: McpServer): void {
  registerJsonTool(
    server,
    "create_renewal_invoice",
    {
      description: "Create the renewal invoice for a contract's next period and link it to the contract. The period starts the day after the contract's current end date and is as long as the contract term (or period_months). It prices every running contract line as on the contract and states the period in each line description. The contract's own line dates are not changed. Refuses when a renewal invoice is already linked, unless allow_duplicate is true.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        contract: z.string().describe("Contract reference (e.g. CT2501-0003) or Dolibarr ID"),
        date: z.string().optional().describe("Invoice date (YYYY-MM-DD). Defaults to today."),
        due_date: z.string().optional().describe("Payment due date (YYYY-MM-DD). Defaults to the date derived from the payment terms."),
        period_months: z.number().int().min(1).max(120).optional().describe("Length of the renewal period. Defaults to the length of the current contract term."),
        validate: z.boolean().default(false).describe("Validate (confirm) the invoice immediately after creation"),
        allow_duplicate: z.boolean().default(false).describe("Create the invoice even though a renewal invoice is already linked"),
      },
    },
    async ({ contract: contractInput, date, due_date, period_months, validate, allow_duplicate }) => {
      const resolved = await resolveContract(contractInput);
      if (!resolved.ok) return resolved.error;

      const result = await renewalInvoiceService.create({
        contract: resolved.contract,
        date,
        dueDate: due_date,
        months: period_months,
        allowDuplicate: allow_duplicate,
        validate,
      });
      if (!("success" in result)) return result;

      return {
        success: true,
        invoice_id: dolibarrId(result.invoiceId),
        contract: result.contract,
        period: result.period,
        lines: result.lines,
        total_excluding_tax: result.totalExcludingTax,
        validated: result.validated,
        linked_to_contract: result.linkedToContract,
        ...(result.existingRenewalInvoiceIds.length > 0
          ? { existing_renewal_invoice_ids: result.existingRenewalInvoiceIds }
          : {}),
        ...(result.linkedToContract
          ? {}
          : { warning: "Dolibarr did not link the invoice to the contract; renewal_invoiced will stay false until it is linked." }),
      };
    },
  );
}
