import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInvoice, listInvoices } from "../../dolibarr/invoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
import { resolveByIdOrRef } from "../shared/resolveByIdOrRef.js";
import {
  dolibarrId,
  isoDateFromTimestamp,
  isPaidInvoice,
  money,
  numberOrUndefined,
  remainingToPay,
} from "../shared/normalization.js";
import { serializeLineItem, serializeThirdpartyIdentity } from "../shared/serializers.js";
import type { DolibarrInvoice } from "../../types/dolibarr.js";

function resolveInvoice(value: string): Promise<DolibarrInvoice | undefined> {
  return resolveByIdOrRef(value, { getById: getInvoice, list: listInvoices });
}

export function registerGetInvoiceDetail(server: McpServer): void {
  registerJsonTool(
    server,
    "get_invoice_detail",
    {
      description: "Get full details of a client invoice: resolved labels, line items, client info, and payment status.",
      inputSchema: { invoice: z.string().describe("Invoice reference (e.g. FA2024-0042) or Dolibarr ID") },
    },
    async ({ invoice: invoiceInput }) => {
      const invoice = await resolveInvoice(invoiceInput);

      if (!invoice) {
        return {
          error: "INVOICE_NOT_FOUND",
          message: `No client invoice found for '${invoiceInput}'.`,
        };
      }

      const client = await getThirdparty(Number(invoice.socid));
      const rawInvoice = invoice as DolibarrInvoice & Record<string, unknown>;
      const paid = isPaidInvoice(invoice);
      const amountPaid = numberOrUndefined(rawInvoice.totalpaid ?? rawInvoice.total_paye);

      return {
        id: dolibarrId(invoice.id),
        ref: invoice.ref,
        status: invoiceStatusLabel(invoice.statut),
        paid,
        payment: {
          paid,
          amount_paid: money(amountPaid),
          remaining_to_pay: remainingToPay(invoice),
        },
        dates: {
          invoice: isoDateFromTimestamp(invoice.date),
          due: isoDateFromTimestamp(invoice.date_lim_reglement),
        },
        totals: {
          total_excluding_tax: money(invoice.total_ht),
          total_tax: money(invoice.total_tva),
          total_including_tax: money(invoice.total_ttc),
        },
        client: serializeThirdpartyIdentity(client),
        lines: (invoice.lines ?? []).map(serializeLineItem),
      };
    },
  );
}
