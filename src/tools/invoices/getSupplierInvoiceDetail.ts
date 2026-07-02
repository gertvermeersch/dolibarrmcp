import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSupplierInvoice, listSupplierInvoices } from "../../dolibarr/supplierInvoices.js";
import { getThirdparty } from "../../dolibarr/thirdparties.js";
import { isDolibarrNotFoundError, toApiError } from "../../dolibarr/client.js";
import { dolibarrQueryString, dolibarrStringLiteral } from "../../dolibarr/sqlFilters.js";
import { invoiceStatusLabel } from "../../dolibarr/statusLabels.js";
import { jsonContent } from "../shared/responses.js";
import type { DolibarrInvoice, DolibarrInvoiceLine } from "../../types/dolibarr.js";

type SupplierInvoice = DolibarrInvoice & {
  ref_supplier?: string;
  refSupplier?: string;
  supplier_ref?: string;
};

type SupplierInvoiceLine = DolibarrInvoiceLine & {
  description?: string;
  pu_ht?: number;
  vat_rate?: number;
};

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

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
  server.registerTool(
    "get_supplier_invoice_detail",
    {
      description: "Get full details of a supplier invoice: resolved labels, line items, supplier info, and payment status.",
      inputSchema: {
        supplier_invoice: z.string().describe("Supplier invoice reference, Dolibarr reference, or Dolibarr ID"),
      },
    },
    async ({ supplier_invoice }) => {
      try {
        const invoice = await resolveSupplierInvoice(supplier_invoice);

        if (!invoice) {
          return jsonContent({
            error: "SUPPLIER_INVOICE_NOT_FOUND",
            message: `No supplier invoice found for '${supplier_invoice}'.`,
          });
        }

        const supplier = await getThirdparty(Number(invoice.socid));
        const rawInvoice = invoice as SupplierInvoice & Record<string, unknown>;
        const paid = invoice.statut === 2 || Number(rawInvoice.paye ?? 0) === 1;
        const amountPaid = numberOrUndefined(rawInvoice.totalpaid ?? rawInvoice.total_paye);
        const remainingToPay =
          numberOrUndefined(rawInvoice.remaintopay ?? rawInvoice.remaining_to_pay) ??
          (amountPaid === undefined ? undefined : Number(invoice.total_ttc) - amountPaid);

        return jsonContent({
          id: invoice.id,
          ref: invoice.ref,
          supplier_ref: supplierRef(rawInvoice),
          status: invoiceStatusLabel(invoice.statut),
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
          supplier: {
            id: supplier.id,
            name: supplier.name,
            code_supplier: supplier.code_fournisseur,
            email: supplier.email,
            phone: supplier.phone,
            address: supplier.address,
            zip: supplier.zip,
            town: supplier.town,
            vat_number: supplier.tva_intra,
          },
          lines: (invoice.lines ?? []).map((line) => {
            const supplierLine = line as SupplierInvoiceLine;
            return {
              id: line.id,
              product_id: line.fk_product,
              product_ref: line.product_ref,
              label: line.product_label ?? line.desc ?? supplierLine.description,
              description: line.desc ?? supplierLine.description,
              qty: line.qty,
              unit_price: line.subprice ?? supplierLine.pu_ht,
              vat_rate: line.tva_tx ?? supplierLine.vat_rate,
              total_ht: line.total_ht,
              total_ttc: line.total_ttc,
            };
          }),
        });
      } catch (err) {
        return jsonContent(toApiError(err));
      }
    },
  );
}
