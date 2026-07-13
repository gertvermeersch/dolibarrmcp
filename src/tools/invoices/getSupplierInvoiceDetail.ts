import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSupplierInvoice, listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
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

type SupplierInvoice = DolibarrInvoice & {
  ref_supplier?: string;
  refSupplier?: string;
  supplier_ref?: string;
};

function supplierRef(invoice: SupplierInvoice): string | undefined {
  return invoice.ref_supplier ?? invoice.refSupplier ?? invoice.supplier_ref;
}

function resolveSupplierInvoice(value: string): Promise<DolibarrInvoice | undefined> {
  return resolveByIdOrRef(value, {
    getById: getSupplierInvoice,
    list: listSupplierInvoices,
    refColumns: ["t.ref", "t.ref_supplier"],
  });
}

export function registerGetSupplierInvoiceDetail(server: McpServer): void {
  registerJsonTool(
    server,
    "get_supplier_invoice_detail",
    {
      description: "Get full details of a supplier invoice: resolved labels, line items, supplier info, and payment status.",
      inputSchema: {
        supplier_invoice: z.string().describe("Supplier invoice reference, Dolibarr reference, or Dolibarr ID"),
      },
    },
    async ({ supplier_invoice }) => {
      const invoice = await resolveSupplierInvoice(supplier_invoice);

      if (!invoice) {
        return {
          error: "SUPPLIER_INVOICE_NOT_FOUND",
          message: `No supplier invoice found for '${supplier_invoice}'.`,
        };
      }

      const supplier = await getThirdparty(Number(invoice.socid));
      const rawInvoice = invoice as SupplierInvoice & Record<string, unknown>;
      const paid = isPaidInvoice(invoice);
      const amountPaid = numberOrUndefined(rawInvoice.totalpaid ?? rawInvoice.total_paye);

      return {
        id: dolibarrId(invoice.id),
        ref: invoice.ref,
        supplier_ref: supplierRef(rawInvoice),
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
        supplier: serializeThirdpartyIdentity(supplier),
        lines: (invoice.lines ?? []).map(serializeLineItem),
      };
    },
  );
}
