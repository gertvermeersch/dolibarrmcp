import { listInvoices, getInvoicePayments } from "../invoices.js";
import { mapWithConcurrency } from "../concurrency.js";
import { cleanString, compactObject, dolibarrId, isIsoDateString, isoDateFromTimestamp, money } from "../../tools/shared/normalization.js";
import { dateRangeError, listResponse, listWindow } from "../../tools/shared/listing.js";
import { resolveMissingThirdpartyNames } from "../../tools/shared/thirdpartyNames.js";

export type PaymentListOptions = {
  thirdparty_id?: number;
  date_from?: string;
  date_to?: string;
  limit: number;
  offset: number;
  max_invoices: number;
  invoice_offset: number;
};

// getListOfPayments returns database date strings on Dolibarr 24, while other
// versions/integrations return Unix timestamps. Preserve the database day.
function paymentDate(value: string | number): string | undefined {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[ T])/.test(value)) {
    const day = value.slice(0, 10);
    return isIsoDateString(day) ? day : undefined;
  }
  return isoDateFromTimestamp(value);
}

export async function readPayments(options: PaymentListOptions): Promise<Record<string, unknown>> {
  const error = dateRangeError(options);
  if (error) return error;
  // Filter dates on the payments, never the invoices: a new payment can settle
  // an invoice issued years ago. No standalone payment-list REST route exists.
  const { rows: invoices, hasMore: moreInvoices } = await listWindow(listInvoices, {
    withLines: "false",
    ...(options.thirdparty_id !== undefined ? { thirdparty_ids: String(options.thirdparty_id) } : {}),
  }, options.max_invoices, options.invoice_offset);
  const allocations = (await mapWithConcurrency(invoices, 5, async (invoice) => {
    const payments = await getInvoicePayments(dolibarrId(invoice.id));
    return payments.flatMap((payment) => {
      if (payment.typeline && payment.typeline !== "payment") return [];
      const date = paymentDate(payment.date);
      if ((options.date_from && (!date || date < options.date_from)) ||
          (options.date_to && (!date || date > options.date_to))) return [];
      return [compactObject({
        payment_ref: cleanString(payment.ref),
        date,
        amount: money(payment.amount),
        payment_mode: cleanString(payment.type),
        number: cleanString(payment.num),
        external_ref: cleanString(payment.ref_ext),
        bank_line_id: payment.fk_bank_line,
        invoice_id: dolibarrId(invoice.id),
        invoice_ref: cleanString(invoice.ref),
        thirdparty_id: dolibarrId(invoice.socid),
      })];
    });
  })).flat();
  allocations.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
    Number(b.invoice_id) - Number(a.invoice_id) || String(a.payment_ref).localeCompare(String(b.payment_ref)));
  const selected = allocations.slice(options.offset, options.offset + options.limit);
  const names = await resolveMissingThirdpartyNames(selected.map((row) => Number(row.thirdparty_id)));
  return {
    ...listResponse("payments", selected.map((row) => ({ ...row, thirdparty_name: names.get(Number(row.thirdparty_id)) })),
      options.limit, options.offset, allocations.length > options.offset + options.limit),
    total_allocations_in_scan: allocations.length,
    scan: {
      invoices_scanned: invoices.length,
      invoice_offset: options.invoice_offset,
      complete: options.invoice_offset === 0 && !moreInvoices,
      more_invoices_available: moreInvoices,
      next_invoice_offset: moreInvoices ? options.invoice_offset + invoices.length : null,
    },
  };
}
