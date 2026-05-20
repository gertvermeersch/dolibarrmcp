import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getInvoice, listInvoices } from "../../dolibarr/invoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { jsonContent } from "../shared/responses.js";
import type { DolibarrInvoice } from "../../types/dolibarr.js";

const invoiceStatus: Record<number, string> = {
  0: "draft",
  1: "validated",
  2: "paid",
  3: "abandoned",
};

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

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
        const paid = invoice.statut === 2 || Number(rawInvoice.paye ?? 0) === 1;
        const amountPaid = numberOrUndefined(rawInvoice.totalpaid ?? rawInvoice.total_paye);
        const remainingToPay =
          numberOrUndefined(rawInvoice.remaintopay ?? rawInvoice.remaining_to_pay) ??
          (amountPaid === undefined ? undefined : Number(invoice.total_ttc) - amountPaid);

        return jsonContent({
          id: invoice.id,
          ref: invoice.ref,
          status: invoiceStatus[Number(invoice.statut)] ?? String(invoice.statut),
          paid,
          payment: {
            paid,
            amount_paid: amountPaid,
            remaining_to_pay: remainingToPay,
          },
          dates: {
            invoice: invoice.date,
            due: invoice.date_lim_reglement,
          },
          totals: {
            total_ht: invoice.total_ht,
            total_tva: invoice.total_tva,
            total_ttc: invoice.total_ttc,
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
          lines: (invoice.lines ?? []).map((line) => ({
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
