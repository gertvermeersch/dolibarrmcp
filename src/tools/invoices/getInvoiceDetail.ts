import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInvoice, listInvoices } from "../../dolibarr/invoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { jsonContent } from "../shared/responses.js";
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

async function resolveInvoice(value: string): Promise<DolibarrInvoice | undefined> {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    try {
      return await getInvoice(Number(trimmed));
    } catch (err) {
      if (isDolibarrNotFoundError(err)) return undefined;
      throw err;
    }
  }

  const invoices = await listInvoices(dolibarrQueryString({
    sqlfilters: `(t.ref:=:${dolibarrStringLiteral(trimmed)})`,
    limit: "1",
  }));

  return invoices[0] ? getInvoice(Number(invoices[0].id)) : undefined;
}

export function registerGetInvoiceDetail(server: McpServer): void {
  server.registerTool(
    "get_invoice_detail",
    {
      description: "Get full details of a client invoice: resolved labels, line items, client info, and payment status.",
      inputSchema: { invoice: z.string().describe("Invoice reference (e.g. FA2024-0042) or Dolibarr ID") },
    },
    async ({ invoice: invoiceInput }) => {
      try {
        const invoice = await resolveInvoice(invoiceInput);

        if (!invoice) {
          return jsonContent({
            error: "INVOICE_NOT_FOUND",
            message: `No client invoice found for '${invoiceInput}'.`,
          });
        }

        const client = await getThirdparty(Number(invoice.socid));
        const rawInvoice = invoice as DolibarrInvoice & Record<string, unknown>;
        const paid = isPaidInvoice(invoice);
        const amountPaid = numberOrUndefined(rawInvoice.totalpaid ?? rawInvoice.total_paye);

        return jsonContent({
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
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
