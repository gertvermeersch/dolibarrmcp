import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSupplierInvoice, listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError } from "../../dolibarr/errors.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { registerJsonTool } from "../shared/registerJsonTool.js";
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

async function resolveSupplierInvoice(value: string): Promise<DolibarrInvoice | undefined> {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    try {
      return await getSupplierInvoice(Number(trimmed));
    } catch (err) {
      if (isDolibarrNotFoundError(err)) return undefined;
      throw err;
    }
  }

  const exactRef = dolibarrStringLiteral(trimmed);
  const invoices = await listSupplierInvoices(dolibarrQueryString({
    sqlfilters: `(t.ref:=:${exactRef}) OR (t.ref_supplier:=:${exactRef})`,
    limit: "1",
  }));

  return invoices[0] ? getSupplierInvoice(Number(invoices[0].id)) : undefined;
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
